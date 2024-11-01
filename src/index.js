// Regex pattern to match the usernames
const usernameRegex = /^@[A-Z][a-z]{2,6}_[A-Za-z0-9]{6,9}$/;

// Helper function to normalize names
function normalizeName(name) {
  const replacements = {
    "Ç": "C", "Ğ": "G", "İ": "I", "Ö": "O", "Ş": "S", "Ü": "U",
    "ç": "c", "ğ": "g", "ı": "i", "ö": "o", "ş": "s", "ü": "u"
  };
  return name
    .split('')
    .map(char => replacements[char] || char)
    .join('')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

// Updated isOneLetterTwoEmojis function with fallback
function isOneLetterTwoEmojis(str) {
  if (!str) return false;

  const firstChar = str.charAt(0);
  if (!/^[A-Za-z]$/.test(firstChar)) {
    return false;
  }

  const rest = str.slice(1).trim();

  let graphemes;
  if (typeof Intl.Segmenter === 'function') {
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    graphemes = [...segmenter.segment(rest)].map(s => s.segment);
  } else {
    // Fallback: Use a regex to split into grapheme clusters
    graphemes = [...rest.matchAll(/./gu)].map(match => match[0]);
  }

  if (graphemes.length !== 2) {
    return false;
  }

  const emojiRegex = /\p{Extended_Pictographic}/u;
  return graphemes.every(grapheme => emojiRegex.test(grapheme));
}

// Main handler function
export default {
  async fetch(request, env, ctx) {
    if (!env.TELEGRAM_TOKEN || !env.BOT_NAME) {
      throw new Error('Environment variables TELEGRAM_TOKEN and BOT_NAME must be set.');
    }

    return handleRequest(request, env);
  }
};

async function handleRequest(request, env) {
  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  let update;
  try {
    update = await request.json();
  } catch (error) {
    if (env.DEBUG_MODE === 'true') {
      console.error(`Error parsing request: ${error.message}`);
    }
    return new Response('Bad Request', { status: 400 });
  }

  // Handle /start command in private chat
  if (update.message && update.message.text === '/start' && update.message.chat.type === 'private') {
    const chatId = update.message.chat.id;
    await sendMessage(chatId, `
Merhaba! Ben bir emoji spam engelleme botuyum. Belirli bir kalıba uygun kullanıcıları tespit edip, gruptan otomatik olarak engellerim.
Lütfen beni grubunuza ekledikten sonra yönetici (admin) olarak atayın. Ancak bu şekilde tam kapasiteyle çalışabilirim.

Hello! I am an emoji spam prevention bot. I detect users matching a specific pattern and automatically ban them from the group.
Please set me as an admin after adding me to your group to ensure full functionality.
    `, env);
    return new Response('OK', { status: 200 });
  }

  // Handle new member joins
  if (update.message && update.message.new_chat_members) {
    const newMembers = update.message.new_chat_members;
    const chatId = update.message.chat.id;

    for (const member of newMembers) {
      // Check if the bot itself was added
      if (member.is_bot && member.username === env.BOT_NAME) {
        await sendMessage(chatId, `
Merhaba! Bu bot, belirli spam davranışlarına sahip kullanıcıları otomatik olarak engeller.
Botun doğru çalışabilmesi için, grup yöneticileri tarafından yönetici olarak atanmalıdır.

Hello! This bot automatically bans users who exhibit specific spam behaviors.
It needs to be set as an admin by group admins to work properly.
            `, env);
        continue;
      }

      const firstName = member.first_name?.normalize('NFC') || '';
      const lastName = member.last_name || '';
      const userName = member.username || '';

      // Match conditions
      const isUsernameMatch = usernameRegex.test(`@${userName}`);
      const isLastNameMatch = isOneLetterTwoEmojis(lastName);

      if (env.DEBUG_MODE === 'true') {
        console.log(`Checking member: ${firstName} ${lastName}, Username: ${userName}`);
        console.log(`Username match: ${isUsernameMatch}, Last name match: ${isLastNameMatch}`);
      }

      if (isUsernameMatch && isLastNameMatch) {
        const banSuccess = await banUser(chatId, member.id, env);
        if (banSuccess) {
          await sendMessage(chatId, `❌ Spam şüphesiyle "${firstName} ${lastName}" isimli kullanıcı engellenmiştir.`, env);
        }
        if (env.DEBUG_MODE === 'true') {
          console.log(`Banned user: ${firstName} (ID: ${member.id})`);
        }
      }
    }
  }

  return new Response('OK', { status: 200 });
}

// Function to send a message to a user
async function sendMessage(chatId, message, env) {
  const url = `https://api.telegram.org/bot${env.TELEGRAM_TOKEN}/sendMessage`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: message })
    });

    const data = await response.json();
    if (!data.ok && env.DEBUG_MODE === 'true') {
      console.error(`Failed to send message: ${data.description}`);
    }
  } catch (error) {
    if (env.DEBUG_MODE === 'true') {
      console.error(`Error in sendMessage: ${error.message}`);
    }
  }
}

// Function to ban a user using Telegram API
async function banUser(chatId, userId, env) {
  const url = `https://api.telegram.org/bot${env.TELEGRAM_TOKEN}/banChatMember`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, user_id: userId })
    });

    const data = await response.json();
    if (!data.ok && env.DEBUG_MODE === 'true') {
      console.error(`Failed to ban user: ${data.description}`);
    }
    return data.ok;
  } catch (error) {
    if (env.DEBUG_MODE === 'true') {
      console.error(`Error in banUser: ${error.message}`);
    }
    return false;
  }
}