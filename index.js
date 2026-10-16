import { makeWASocket, useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import axios from 'axios';
import zlib from 'zlib';
import fs from 'fs';

// ==========================================
// KONFIGURASI UTAMA ALTRA SHOES BOT
// ==========================================
const NOMOR_BOS = '6285973984510'; // Ganti / sesuaikan nomor utama Bos Blay
const NOMOR_ATTA = '628...';       // Sesuaikan jika ada nomor Atta/Kontrex
const WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbxcadKMppCjaGuTyU4j-VTIFlOLVD8W9dwGqmozn_MamPdVTFTEKpfK3HVZk4J14gqWNQ/exec';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY; 

let riwayatGrup = [];
let sesiPembeli = {};

// RESTORE SESSION DARI RAILWAY VARIABLE (BASE64 ZLIB)
async function restoreSessionFromEnv() {
    if (process.env.SESSION_BASE64) {
        try {
            const bufferCompressed = Buffer.from(process.env.SESSION_BASE64, 'base64');
            const bufferJson = zlib.inflateSync(bufferCompressed);
            const sessionData = JSON.parse(bufferJson.toString('utf8'));
            
            if (!fs.existsSync('auth_info_baileys')) {
                fs.mkdirSync('auth_info_baileys', { recursive: true });
            }
            
            for (const [filename, content] of Object.entries(sessionData)) {
                fs.writeFileSync(`auth_info_baileys/${filename}`, JSON.stringify(content, null, 2));
            }
            console.log('✅ Sesi berhasil di-restore otomatis dari Railway Variable (Zlib Decompressed)!');
        } catch (e) {
            console.log('⚠️ Gagal restore sesi zlib:', e.message);
        }
    }
}

// FUNGSI PEMANGGIL OTAK GEMINI (DENGAN OTAK PERMANEN SOP LENGKAP)
async function panggilGeminiAQ(pesanUser, customPrompt = "") {
    if (!GEMINI_API_KEY) return "⚠️ API Key Gemini belum dipasang di environment Railway!";
    
    // OTAK PERMANEN: Rangkuman seluruh instruksi dan SOP Altra Shoes dari awal
    const sistemPromptGlobal = `Kamu adalah Asisten AI dan Mentor Bisnis tingkat atas untuk Putra (dipanggil "Blay"), owner retail sepatu "Altra Shoes" di Tangerang, agen "Lion Parcel", dan kurir project delivery JNE Erajaya. Partnernya bernama Alika. 
    Karakter: Bahasa gaul, akrab, maskulin, solutif, dan selalu ingatkan tentang cashflow serta sedekah.
    SOP Khusus Bot:
    - Jika diminta ekstrak resi/gagal kirim, format output JSON wajib: {"nama": "...", "nomor_hp": "...", "resi": "..."}.
    - Tangani perintah cek stok, update stok, analisis grup, dan follow-up pengiriman dengan teliti.`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;
    
    try {
        const response = await axios.post(url, {
            contents: [{
                parts: [{ text: `${sistemPromptGlobal}\n\nInstruksi Khusus/Konteks: ${customPrompt}\nPesan User: ${pesanUser}` }]
            }]
        }, {
            headers: { 'Content-Type': 'application/json' }
        });
        
        return response.data.candidates[0].content.parts[0].text;
    } catch (error) {
        console.error('Error Gemini API:', error.response?.data || error.message);
        return "⚠️ Maaf Blay, otak Gemini lagi sedikit kendala koneksi.";
    }
}

async function startBot() {
    await restoreSessionFromEnv();
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    
    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: true,
        browser: ["Altra Shoes Bot", "Chrome", "10.0"]
    });

    sock.udarstven?.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Koneksi terputus, mencoba menghubungkan ulang...', shouldReconnect);
            if (shouldReconnect) {
                startBot();
            }
        } else if (connection === 'open') {
            console.log('🚀 MANTAP BLAY! BOT ALTRA SHOES SUPER AUTOPILOT TERHUBUNG!');
            try {
                await sock.sendMessage(NOMOR_BOS + '@s.whatsapp.net', { 
                    text: '🔄 [SYSTEM PING] Otak Gemini Flash & Seluruh SOP Permanen udah sinkron, Blay! Bot siap tempur.' 
                });
            } catch (err) {}
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const senderJid = msg.key.remoteJid;
        const messageText = msg.message.conversation || msg.message.extendedTextMessage?.text || msg.message.imageMessage?.caption || '';

        let cleanSender = msg.key.participant || senderJid;
        cleanSender = cleanSender.replace('@s.whatsapp.net', '').split(':')[0];
        if (cleanSender.startsWith('0')) cleanSender = '62' + cleanSender.substring(1);

        console.log(`📥 [LOG MASUK] Dari: ${cleanSender} | Pesan: ${messageText}`);

        if (!messageText) return;

        // IDENTIFIKASI BOS AMAN (MENDUKUNG NOMOR ASLI & NOMOR LID HIDDEN WA)
        const isBos = cleanSender.endsWith('5628') || cleanSender.includes(NOMOR_BOS) || cleanSender.includes('207923829592283');
        const isAtta = cleanSender.includes(NOMOR_ATTA);
        const isGroup = senderJid.endsWith('@g.us');

        // ==========================================
        // FITUR A: LOGIKA PERCAKAPAN DI DALAM GRUP
        // ==========================================
        if (isGroup) {
            riwayatGrup.push(`[Dari: ${isBos ? 'Blay' : isAtta ? 'Bang Atta' : 'Tim'}]: ${messageText}`);
            if (riwayatGrup.length > 50) riwayatGrup.shift();

            const isMentioned = messageText.includes(`@${NOMOR_BOT}`) || messageText.toLowerCase().includes('bot');

            if (isBos && isMentioned && (messageText.toLowerCase().includes('gagal') || messageText.toLowerCase().includes('follow up'))) {
                let promptEkstrak = `Tugas: Ekstrak Data Pembeli & Nomor Resi dari teks pengiriman gagal. Format WAJIB JSON persis seperti ini tanpa tambahan teks lain: {"nama": "Berto", "nomor_hp": "628...", "resi": "11LP179..."}. Teks: ${messageText}`;
                let hasilEkstrak = await panggilGeminiAQ(messageText, promptEkstrak);
                
                try {
                    let jsonMatch = hasilEkstrak.match(/\{.*\}/s);
                    if (jsonMatch) {
                        let dataParsed = JSON.parse(jsonMatch[0]);
                        if (dataParsed.nomor_hp && dataParsed.resi) {
                            let noPembeli = dataParsed.nomor_hp.replace(/[^0-9]/g, ''); 
                            if (noPembeli.startsWith('0')) noPembeli = '62' + noPembeli.substring(1);
                            
                            sesiPembeli[noPembeli] = { nama: dataParsed.nama || "Kak", resi: dataParsed.resi, grupAsal: senderJid, dataLengkap: messageText };
                            
                            let pesanKePembeli = `Halo ${dataParsed.nama || "Kak"}! 👋 Kami dari tim logistik *Altra Shoes* (via Lion Parcel).\n\nKami mendapat laporan kalau paket kakak dengan resi *${dataParsed.resi}* gagal terkirim oleh kurir hari ini.\n\nApakah paketnya mungkin sudah kakak terima? Jika belum, apakah kakak mau dibantu *Kirim Ulang* atau di *Retur*? Balas "KIRIM ULANG" atau "RETUR" ya kak. Terima kasih banyak! 🙏`;
                            await sock.sendMessage(noPembeli + '@s.whatsapp.net', { text: pesanKePembeli });
                            await sock.sendMessage(senderJid, { text: `✅ Siap Bos! Data berhasil diekstrak dan gue udah konfirmasi via japri ke nomor pembelinya.` });
                        }
                    }
                } catch (e) {
                    await sock.sendMessage(senderJid, { text: `⚠️ Error nge-ekstrak data nih Bos.` });
                }
            } else if (isMentioned) {
                let cleanMessage = messageText.replace(new RegExp(`@${NOMOR_BOT}|bot`, 'gi'), "").trim();
                let respon = await panggilGeminiAQ(cleanMessage, "Jawab santai, padat, dan langsung ke intinya aja.");
                await sock.sendMessage(senderJid, { text: `🤖 Yo blay! ${respon}` });
            }
            return;
        }

        // ==========================================
        // FITUR B: LOGIKA JAPRI PEMBELI
        // ==========================================
        if (!isGroup && !isBos && !isAtta && sesiPembeli[cleanSender]) {
            let { resi, grupAsal, dataLengkap } = sesiPembeli[cleanSender];
            let keputusan = await panggilGeminiAQ(messageText, `Baca: "${messageText}". Tentukan apakah "RETUR", "KIRIM ULANG", "SUDAH DITERIMA". Balas HANYA kata tersebut.`);

            if (keputusan.includes("SUDAH DITERIMA")) {
                await sock.sendMessage(senderJid, { text: `Alhamdulillah! Ditunggu next ordernya kak! 🙏` });
                await sock.sendMessage(grupAsal, { text: `✅ *UPDATE PAKET BLAY!*\n\nPembeli (Resi: ${resi}) konfirmasi paket *SUDAH DITERIMA*.` });
                delete sesiPembeli[cleanSender];
            } else if (keputusan.includes("RETUR") || keputusan.includes("KIRIM ULANG")) {
                let statusFinal = keputusan.includes("RETUR") ? "RETUR" : "KIRIM ULANG";
                await sock.sendMessage(senderJid, { text: `Baik kak, permintaan *${statusFinal}* segera diproses. Terima kasih! 🙏` });
                try { await axios.post(LION_PARCEL_CS_API, { data: dataLengkap, status: statusFinal }); } catch (e) {}
                await sock.sendMessage(grupAsal, { text: `✅ *UPDATE PAKET GAGAL!*\n\nPembeli milih: *${statusFinal}* (Resi: ${resi}). Data terkirim ke CS!` });
                delete sesiPembeli[cleanSender]; 
            } else {
                await sock.sendMessage(senderJid, { text: `Maaf kak, tolong balas dengan *RETUR* atau *KIRIM ULANG*.` });
            }
            return;
        }

        // ==========================================
        // FITUR C: LOGIKA JAPRI BOS (PUTRA/BLAY)
        // ==========================================
        if (!isGroup && isBos) {
            const upperText = messageText.toUpperCase();
            if (upperText.includes("ANALISIS GRUP") || upperText.includes("SARAN BISNIS")) {
                let responAnalisis = await panggilGeminiAQ("Analisis", `Analisis riwayat chat grup: ${riwayatGrup.join(" | ")}`);
                await sock.sendMessage(senderJid, { text: `📊 *HASIL ANALISIS GRUP:*\n\n${responAnalisis}` });
            } else if (upperText.includes("CEK STOK") || upperText.includes("STOK")) {
                try {
                    let res = await axios.get(`${WEB_APP_URL}?action=cekStok&query=${encodeURIComponent(messageText)}`);
                    await sock.sendMessage(senderJid, { text: `📦 ${res.data.result || "Stok berhasil dicek dari Google Sheets."}` });
                } catch (e) {
                    await sock.sendMessage(senderJid, { text: "⚠️ Sistem Sheet sedang lambat." });
                }
            } else if (upperText.includes("UPDATE STOK") || upperText.includes("SOLD")) {
                try {
                    let res = await axios.post(WEB_APP_URL, { action: 'updateStok', text: messageText });
                    await sock.sendMessage(senderJid, { text: `🔄 ${res.data.result || "Stok diperbarui!"}` });
                } catch (e) {
                    await sock.sendMessage(senderJid, { text: "⚠️ Gagal update ke sistem." });
                }
            } else {
                let aiRespon = await panggilGeminiAQ(messageText, "Jawab sebagai mentor bisnis pribadi untuk Blay.");
                await sock.sendMessage(senderJid, { text: aiRespon });
            }
        }
    });
}

startBot();
