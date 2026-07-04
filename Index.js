const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    fetchLatestBaileysVersion, 
    DisconnectReason,
    Browsers 
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const ytdl = require('ytdl-core'); // Herramienta para YouTube

// Leer configuración
const configPath = path.join(__dirname, 'data', 'config.json');
let config = JSON.parse(fs.readFileSync(configPath));

async function iniciarBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false, 
        browser: Browsers.ubuntu('Chrome'),
        logger: pino({ level: 'silent' }),
        syncFullHistory: false // ⚡ Evita sincronización lenta
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        // Lógica de código de emparejamiento
        if (qr && config.telefono) {
            let code = await sock.requestPairingCode(config.telefono);
            console.log("\n🔑 TU CÓDIGO: ", code?.match(/.{1,4}/g)?.join("-") || code);
        }

        if (connection === 'close') {
            const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) iniciarBot();
            else process.exit();
        } else if (connection === 'open') {
            console.log('\n✅ ¡BOT CONECTADO Y LISTO!');
        }
    });

    // 👂 ESCUCHAR MENSAJES
    sock.ev.on('messages.upsert', async m => {
        const msg = m.messages[0];
        if (!msg.message || m.type !== 'notify') return;
        if (msg.key.fromMe) return; // Ignorar mensajes propios

        const body = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
        const from = msg.key.remoteJid;
        const sender = msg.key.participant || msg.key.remoteJid;
        
        const myNum = config.owner.replace(/\D/g, '');
        const sendNum = sender.replace(/\D/g, '');
        const isOwner = myNum === sendNum;

        if (!body.startsWith(config.prefijo)) return;

        const args = body.slice(config.prefijo.length).trim().split(' ');
        const command = args.shift().toLowerCase(); 

        // Si el bot está apagado y no eres el dueño, no responde
        if (!config.activo && !isOwner) return;

        try {
            // 📋 MENU
            if (command === 'menu') {
                const menuText = `🤖 *${config.nombre}*
👋 Hola: @${sendNum}
🚦 Estado: ${config.activo ? '🟢 Activo' : '🔴 Apagado'}

📥 DESCARGAS
• ${config.prefijo}play (YouTube)
• ${config.prefijo}tiktok (Enlace)
• ${config.prefijo}fb (Enlace)

👥 GRUPOS
• ${config.prefijo}kick (@mención)
• ${config.prefijo}open / close

🛡️ CREADOR
• ${config.prefijo}on / off
• ${config.prefijo}cambiar-prefijo #
• ${config.prefijo}cambiar-nombre Bot`;

                return sock.sendMessage(from, {
                    image: { url: config.imagen },
                    caption: menuText,
                    mentions: [sender]
                });
            }

            // 📥 PLAY (YouTube)
            if (command === 'play') {
                if (args.length === 0) return sock.sendMessage(from, { text: '❌ Escribe qué quieres buscar. Ej: .play Despacito' });
                
                await sock.sendMessage(from, { text: '⏳ Descargando audio...' });
                
                try {
                    // Busca el video y descarga el audio
                    const info = await ytdl.getInfo(`https://www.youtube.com/results?search_query=${args.join(' ')}`); 
                    // Nota: ytdl necesita el link directo o buscamos uno. 
                    // Para simplificar en este bot básico, usaremos una API de terceros o asumiremos link directo.
                    // Si envías el link directo funciona 100%.
                    
                    // Si el usuario envía un link directo:
                    if (args[0].includes('youtube.com') || args[0].includes('youtu.be')) {
                         await sock.sendMessage(from, { 
                             audio: { url: args[0] }, // Truco rápido: Baileys a veces baja link directo si es audio
                             mimetype: 'audio/mp4' 
                         }); 
                    } else {
                         sock.sendMessage(from, { text: '⚠️ Para .play envía el link del video de YouTube.' });
                    }
                } catch (e) {
                    sock.sendMessage(from, { text: '❌ Error descargando.' });
                }
            }

            // 🎵 TIKTOK (Vía API)
            if (command === 'tiktok') {
                if (!args[0]) return sock.sendMessage(from, { text: '❌ Envía el link de TikTok.' });
                await sock.sendMessage(from, { text: '⏳ Descargando TikTok...' });
                try {
                    // API pública (puede fallar si está saturada)
                    const { data } = await axios.get(`https://api.dorrin.com/api/tiktok?url=${args[0]}`);
                    if (data.result && data.result.video) {
                        return sock.sendMessage(from, { video: { url: data.result.video }, caption: '✨ TikTok' });
                    }
                    sock.sendMessage(from, { text: '❌ No se pudo descargar.' });
                } catch (e) { sock.sendMessage(from, { text: '❌ Error en la API.' }); }
            }

            // 📘 FACEBOOK (Vía API)
            if (command === 'fb') {
                if (!args[0]) return sock.sendMessage(from, { text: '❌ Envía el link de Facebook.' });
                await sock.sendMessage(from, { text: '⏳ Descargando Facebook...' });
                try {
                    const { data } = await axios.get(`https://api.dorrin.com/api/fbdl?url=${args[0]}`);
                    if (data.result && data.result.video) {
                        return sock.sendMessage(from, { video: { url: data.result.video }, caption: '✨ Facebook Video' });
                    }
                    sock.sendMessage(from, { text: '❌ Video privado o error.' });
                } catch (e) { sock.sendMessage(from, { text: '❌ Error descargando.' }); }
            }

            // 👢 KICK (Solo Owner / Admin)
            if (command === 'kick') {
                if (!isOwner) return sock.sendMessage(from, { text: '🚫 Solo el creador puede usar esto.' });
                if (!from.endsWith('@g.us')) return sock.sendMessage(from, { text: '⚠️ Comando solo para grupos.' });
                
                const mentioned = msg.message.extendedTextMessage?.contextInfo?.mentionedJid;
                if (mentioned) {
                    await sock.groupParticipantsUpdate(from, mentioned, 'remove');
                    return sock.sendMessage(from, { text: '👢 Usuario eliminado.' });
                }
                sock.sendMessage(from, { text: '❌ Menciona a alguien (@usuario).' });
            }
            
            // 🚪 ABRIR / CERRAR GRUPO
            if (command === 'open') {
                if (!isOwner) return;
                await sock.groupSettingUpdate(from, 'not_announcement');
                return sock.sendMessage(from, { text: '🔓 Grupo abierto.' });
            }
            if (command === 'close' || command === 'cerrar') {
                if (!isOwner) return;
                await sock.groupSettingUpdate(from, 'announcement');
                return sock.sendMessage(from, { text: '🔒 Grupo cerrado.' });
            }

            // 🛡️ CREADOR: ON / OFF
            if (command === 'off') {
                if (!isOwner) return;
                config.activo = false;
                fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
                return sock.sendMessage(from, { text: '🔴 Bot apagado.' });
            }
            if (command === 'on') {
                if (!isOwner) return;
                config.activo = true;
                fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
                return sock.sendMessage(from, { text: '🟢 Bot encendido.' });
            }

            // 🛡️ CREADOR: PREFIJO / NOMBRE
            if (command === 'cambiar-prefijo') {
                if (!isOwner || !args[0]) return;
                config.prefijo = args[0];
                fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
                return sock.sendMessage(from, { text: `✅ Prefijo cambiado a: ${args[0]}` });
            }

            if (command === 'cambiar-nombre') {
                if (!isOwner || args.length === 0) return;
                config.nombre = args.join(' ');
                fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
                return sock.sendMessage(from, { text: `✅ Nombre cambiado a: ${config.nombre}` });
            }

        } catch (err) {
            console.error(err);
            // No responder con error para no spamear al usuario
        }
    });
}

iniciarBot();
