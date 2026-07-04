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
        logger: pino({ level: 'silent' })
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        // 🔥 Lógica para generar CÓDIGO DE ENLACE en lugar de QR
        if (qr) {
            if (config.telefono) {
                // Pedimos el código a WhatsApp usando el número del config
                let code = await sock.requestPairingCode(config.telefono);
                code = code?.match(/.{1,4}/g)?.join("-") || code;
                console.log("\n━━━━━━━━━━━━━━━━━━━━");
                console.log("🔑 TU CÓDIGO ES: ", code);
                console.log("━━━━━━━━━━━━━━━━━━━━\n");
                console.log("📲 Ve a WhatsApp > Dispositivos vinculados > Vincular con número de teléfono > Escribe el código");
            } else {
                console.log("⚠️ Error: No pusiste tu número en config.json");
            }
        }

        if (connection === 'close') {
            const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) {
                iniciarBot();
            } else {
                console.log("❌ Sesión cerrada.");
                process.exit();
            }
        } else if (connection === 'open') {
            console.log('\n✅ ¡BOT CONECTADO!');
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const body = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
        const from = msg.key.remoteJid;
        const sender = msg.key.participant || msg.key.remoteJid;
        
        // Verificar si es el dueño
        const myNumber = config.owner.replace(/\D/g, '');
        const senderNumber = sender.replace(/\D/g, '');
        const isOwner = myNumber === senderNumber;

        if (!body.startsWith(config.prefijo)) return;

        const comando = body.slice(config.prefijo.length).trim().split(' ')[0].toLowerCase();
        const args = body.slice(config.prefijo.length).trim().split(' ').slice(1);

        try {
            if (comando === 'menu') {
                const menu = `🤖 *${config.nombre}*
👋 Hola: @${senderNumber}

📥 DESCARGAS
• .play (audio)
• .tiktok (video)
• .fb (video)

🛡️ ADMIN
• .on / .off
• .cambiar-prefijo #
• .cambiar-nombre Bot`;
                return sock.sendMessage(from, { text: menu, mentions: [sender] });
            }

            if (comando === 'off') {
                if (!isOwner) return;
                config.activo = false;
                fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
                return sock.sendMessage(from, { text: '🔴 Bot apagado.' });
            }

            if (comando === 'on') {
                if (!isOwner) return;
                config.activo = true;
                fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
                return sock.sendMessage(from, { text: '🟢 Bot encendido.' });
            }

            if (comando === 'cambiar-prefijo') {
                if (!isOwner || !args[0]) return;
                config.prefijo = args[0];
                fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
                return sock.sendMessage(from, { text: `✅ Nuevo prefijo: ${args[0]}` });
            }

        } catch (err) {
            console.error(err);
        }
    });
}

iniciarBot();
