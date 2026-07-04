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
const yts = require('yt-search'); // Para buscar canciones

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
        syncFullHistory: false
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr && config.telefono) {
            let code = await sock.requestPairingCode(config.telefono);
            console.log("\n🔑 TU CÓDIGO: ", code?.match(/.{1,4}/g)?.join("-") || code);
        }
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) iniciarBot();
            else process.exit();
        } else if (connection === 'open') {
            console.log('\n✅ ¡BOT CONECTADO!');
        }
    });

    sock.ev.on('messages.upsert', async m => {
        const msg = m.messages[0];
        if (!msg.message || m.type !== 'notify') return;
        if (msg.key.fromMe) return;

        const body = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
        const from = msg.key.remoteJid;
        const sender = msg.key.participant || msg.key.remoteJid;
        
        const myNum = config.owner.replace(/\D/g, '');
        const sendNum = sender.replace(/\D/g, '');
        const isOwner = myNum === sendNum;

        if (!body.startsWith(config.prefijo)) return;

        const args = body.slice(config.prefijo.length).trim().split(' ');
        const command = args.shift().toLowerCase(); 

        if (!config.activo && !isOwner) return;

        try {
            // 📋 MENU
            if (command === 'menu') {
                const menuText = `🤖 *${config.nombre}*
👋 Hola: @${sendNum}
🚦 Estado: ${config.activo ? '🟢 Activo' : '🔴 Apagado'}

📥 DESCARGAS
• ${config.prefijo}play (nombre o link)
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

            // 🎵 PLAY (ARREGLADO CON API EXTERNA)
            if (command === 'play') {
                if (args.length === 0) return sock.sendMessage(from, { text: '❌ ¿Qué quieres escuchar? Ej: .play Bad Bunny' });
                
                let videoUrl = args.join(' ');
                if (!videoUrl.includes('youtube.com') && !videoUrl.includes('youtu.be')) {
                    await sock.sendMessage(from, { text: '🔍 Buscando...' });
                    const search = await yts(videoUrl);
                    if (search.videos.length === 0) return sock.sendMessage(from, { text: '❌ No encontré esa canción.' });
                    videoUrl = search.videos[0].url;
                }

                await sock.sendMessage(from, { text: '⏳ Descargando audio...' });
                try {
                    // API externa que evita el bloqueo de YouTube
                    const api = `https://api.siputzx.my.id/api/dl/ytmp3?url=${encodeURIComponent(videoUrl)}`;
                    const res = await axios.get(api);

                    if (res.data.status && res.data.result) {
                        return sock.sendMessage(from, {
                            audio: { url: res.data.result },
                            mimetype: 'audio/mp4',
                            fileName: 'Izraelita03.mp3'
                        });
                    }
                    sock.sendMessage(from, { text: '❌ La API está ocupada. Intenta en unos segundos.' });
                } catch (err) {
                    sock.sendMessage(from, { text: '❌ Error al descargar. Verifica el enlace.' });
                }
            }

            // 🎵 TIKTOK
            if (command === 'tiktok') {
                if (!args[0]) return sock.sendMessage(from, { text: '❌ Envía el link de TikTok.' });
                await sock.sendMessage(from, { text: '⏳ Descargando TikTok...' });
                try {
                    const { data } = await axios.get(`https://api.dorrin.com/api/tiktok?url=${args[0]}`);
                    if (data.result && data.result.video) {
                        return sock.sendMessage(from, { video: { url: data.result.video }, caption: '✨ TikTok' });
                    }
                    sock.sendMessage(from, { text: '❌ No se pudo descargar.' });
                } catch (e) { sock.sendMessage(from, { text: '❌ Error en la API.' }); }
            }

            // 📘 FACEBOOK
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

            // 👢 KICK
            if (command === 'kick') {
                if (!isOwner) return sock.sendMessage(from, { text: '🚫 Solo el creador.' });
                const mentioned = msg.message.extendedTextMessage?.contextInfo?.mentionedJid;
                if (mentioned) {
                    await sock.groupParticipantsUpdate(from, mentioned, 'remove');
                    return sock.sendMessage(from, { text: '👢 Usuario eliminado.' });
                }
                sock.sendMessage(from, { text: '❌ Menciona a alguien (@usuario).' });
            }
            
            // 🚪 OPEN / CLOSE
            if (command === 'open') {
                if (!isOwner) return;
                await sock.groupSettingUpdate(from, 'not_announcement');
                return sock.sendMessage(from, { text: '🔓 Grupo abierto.' });
            }
            if (command === 'close') {
                if (!isOwner) return;
                await sock.groupSettingUpdate(from, 'announcement');
                return sock.sendMessage(from, { text: '🔒 Grupo cerrado.' });
            }

            // 🛡️ CREADOR
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
            if (command === 'cambiar-prefijo') {
                if (!isOwner || !args[0]) return;
                config.prefijo = args[0];
                fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
                return sock.sendMessage(from, { text: `✅ Prefijo: ${args[0]}` });
            }
            if (command === 'cambiar-nombre') {
                if (!isOwner || args.length === 0) return;
                config.nombre = args.join(' ');
                fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
                return sock.sendMessage(from, { text: `✅ Nombre: ${config.nombre}` });
            }

        } catch (err) {
            console.error(err);
        }
    });
}

iniciarBot();
