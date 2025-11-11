import 'dotenv/config';
import { Telegraf, Markup } from 'telegraf';
import dayjs from 'dayjs';
import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';
import { customAlphabet } from 'nanoid';

const BOT_TOKEN = process.env.BOT_TOKEN;
const TELEGRAM_WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET;
if (!BOT_TOKEN) throw new Error('BOT_TOKEN is required');

const nanoid = customAlphabet('1234567890abcdefghijklmnopqrstuvwxyz', 10);
const adapter = new JSONFile('/tmp/db.json');
const db = new Low(adapter, {
  users: {},
  sessions: {},
  products: [
    { sku: 'set-cleanse-intense-0+', title: 'Natuma Эмолибейз набор эмолентов очищение и интенсивное увлажнение 0+', kaspiUrl: '', wbUrl: '' },
    { sku: 'set-cleanse-body-0+', title: 'Natuma Эмолибейз набор эмолентов очищение и увлажнение для тела 0+', kaspiUrl: '', wbUrl: '' },
    { sku: 'set-cleanse-protect-0+', title: 'Natuma Эмолибейз набор эмолентов очищение, увлажнение и защита 0+', kaspiUrl: '', wbUrl: '' },
    { sku: 'set-kids-0+', title: 'Natuma Эмолибейз набор эмолентов очищение и увлажнение для детей с рождения 0+', kaspiUrl: '', wbUrl: '' },
    { sku: 'set-family-0+', title: 'Natuma Эмолибейз набор эмолентов для всей семьи очищение, увлажнение и защита 0+', kaspiUrl: '', wbUrl: '' }
  ],
  dripQueue: []
});
await db.read(); await db.write();

const bot = new Telegraf(BOT_TOKEN);
function h(s){ return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
const ADMIN_IDS=(process.env.ADMIN_IDS||'').split(',').map(s=>s.trim()).filter(Boolean);
function isAdmin(id){return ADMIN_IDS.includes(String(id));}
function getUser(chatId){ if(!db.data.users[chatId]) db.data.users[chatId]={chatId,createdAt:Date.now(),profile:{}}; return db.data.users[chatId]; }
function getProductBySku(sku){ return db.data.products.find(p=>p.sku===sku); }
const S={ IDLE:'IDLE', FOR_WHO:'FOR_WHO', PROBLEM:'PROBLEM', ZONE:'ZONE', DONE:'DONE' };
function getSession(chatId){ if(!db.data.sessions[chatId]) db.data.sessions[chatId]={state:S.IDLE,answers:{}}; return db.data.sessions[chatId]; }
function resetSession(chatId){ db.data.sessions[chatId]={state:S.IDLE,answers:{}}; }
function kbMain(){ return Markup.keyboard([['🧪 Подбор ухода','📦 Каталог'],['ℹ️ Как купить','🧑‍⚕️ Что такое эмоленты?']]).resize(); }

async function sendProductRecommendation(ctx, answers){
  const { forWho, problem, zone } = answers;
  let sku='set-cleanse-intense-0+';
  if(forWho==='kid') sku='set-kids-0+';
  else if(forWho==='both') sku=(problem==='irritation')?'set-cleanse-protect-0+':'set-family-0+';
  else if(forWho==='me'){
    if(problem==='dryness') sku = (zone==='face') ? 'set-cleanse-intense-0+' : 'set-cleanse-body-0+';
    else if(problem==='irritation') sku='set-cleanse-protect-0+';
    else if(problem==='flaky') sku='set-cleanse-intense-0+';
    else if(problem==='aftercare') sku='set-cleanse-protect-0+';
  }
  const product=getProductBySku(sku)||db.data.products[0];
  const buttons=[];
  if(product.kaspiUrl) buttons.push(Markup.button.url('🛍 Купить на Kaspi', product.kaspiUrl));
  if(product.wbUrl) buttons.push(Markup.button.url('🛍 Купить на WB', product.wbUrl));
  await ctx.reply(`✅ Подобрали набор: <b>${h(product.title)}</b>\n\n`+
  `Почему именно он:\n• Восстанавливает барьер кожи\n• Снимает сухость/стянутость и раздражение\n`+
  `• Без ароматизаторов и парабенов, подходит с 0 лет\n\nНиже — ссылки на покупку:`,
  { parse_mode:'HTML', ...Markup.inlineKeyboard(buttons,{columns:1})});
}

bot.start(async ctx=>{ getUser(ctx.chat.id); await db.write(); await ctx.reply(`Привет, ${h(ctx.from.first_name||'друг')}! 🌿\nЯ помогу подобрать уход EMOLYBASE.`, { parse_mode:'HTML', ...kbMain() }); });
bot.help(async ctx=>{ await ctx.reply('Нажми «🧪 Подбор ухода» и ответь на 3 вопроса.'); });
bot.hears('📦 Каталог', async ctx=>{ for(const p of db.data.products){ const btns=[]; if(p.kaspiUrl) btns.push(Markup.button.url('Kaspi',p.kaspiUrl)); if(p.wbUrl) btns.push(Markup.button.url('WB',p.wbUrl)); await ctx.replyWithHTML(`• <b>${h(p.title)}</b>`, Markup.inlineKeyboard(btns)); }});
bot.hears('🧪 Подбор ухода', async ctx=>{ const s=getSession(ctx.chat.id); s.state=S.FOR_WHO; await db.write(); await ctx.reply('Кому нужен уход?', Markup.keyboard([['Мне','Ребёнку'],['Обоим']]).resize()); });
bot.on('text', async ctx=>{ const s=getSession(ctx.chat.id); const t=(ctx.message.text||'').trim();
  if(s.state===S.FOR_WHO){ s.answers.forWho=(t==='Мне'?'me':t==='Ребёнку'?'kid':t==='Обоим'?'both':null); if(!s.answers.forWho)return; s.state=S.PROBLEM; await db.write(); await ctx.reply('Что беспокоит?', Markup.keyboard([['Сухость','Покраснение'],['Шелушение','После процедур']]).resize()); return; }
  if(s.state===S.PROBLEM){ s.answers.problem=(t.startswith('Сух')?'dryness':t.startswith('Покрас')?'irritation':t.startswith('Шел')?'flaky':'aftercare'); s.state=S.ZONE; await db.write(); await ctx.reply('Где проявляется?', Markup.keyboard([['Лицо','Тело'],['И там, и там']]).resize()); return;}
  if(s.state===S.ZONE){ s.answers.zone=(t=='Лицо'?'face':t=='Тело'?'body':'both'); s.state=S.DONE; await db.write(); await sendProductRecommendation(ctx, s.answers); resetSession(ctx.chat.id); await db.write(); return;}
});

export default async function handler(req, res){
  if (TELEGRAM_WEBHOOK_SECRET && req.headers['x-telegram-bot-api-secret-token'] !== TELEGRAM_WEBHOOK_SECRET){ res.status(401).send('unauthorized'); return; }
  if (req.method === 'POST'){ try { await bot.handleUpdate(req.body); res.status(200).send('ok'); } catch(e){ console.error(e); res.status(200).send('ok'); } }
  else { res.status(200).send('ok'); }
}
