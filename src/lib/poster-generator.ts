import QRCode from "qrcode";

/**
 * Generates an architectural, high-resolution A4/8.5x11 printable poster
 * and triggers a client-side download as a PNG file.
 */
export async function downloadVenuePoster(venueTitle: string, queueUrl: string) {
  if (typeof window === "undefined") return;

  // 1. Generate high-resolution QR data URL
  const qrDataUrl = await QRCode.toDataURL(queueUrl, {
    margin: 1,
    width: 900,
    color: {
      dark: "#111111",
      light: "#FFFFFF",
    },
  });

  // 2. Build high-res canvas (1200 x 1700 portrait poster)
  const canvas = document.createElement("canvas");
  canvas.width = 1200;
  canvas.height = 1700;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  // Background - Warm Milk
  ctx.fillStyle = "#FBF9F5";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Outer Decorative Border
  ctx.strokeStyle = "#111111";
  ctx.lineWidth = 10;
  ctx.strokeRect(40, 40, canvas.width - 80, canvas.height - 80);

  // Inner subtle border
  ctx.strokeStyle = "#E8E5DF";
  ctx.lineWidth = 2;
  ctx.strokeRect(55, 55, canvas.width - 110, canvas.height - 110);

  // Top Wordmark "Q"
  ctx.fillStyle = "#111111";
  ctx.font = "bold 56px 'Geist Mono', monospace";
  ctx.textAlign = "center";
  ctx.fillText("Q", canvas.width / 2, 140);

  ctx.font = "bold 16px 'Geist Mono', monospace";
  ctx.fillStyle = "#666666";
  ctx.letterSpacing = "6px";
  ctx.fillText("OFFICIAL VIRTUAL QUEUE", canvas.width / 2, 175);
  ctx.letterSpacing = "0px";

  // Venue / Queue Title
  ctx.fillStyle = "#111111";
  ctx.font = "bold 44px 'Geist Mono', monospace";
  const title = venueTitle.length > 36 ? venueTitle.slice(0, 34) + "…" : venueTitle;
  ctx.fillText(title, canvas.width / 2, 250);

  // White Card for QR Code
  ctx.fillStyle = "#FFFFFF";
  ctx.strokeStyle = "#E8E5DF";
  ctx.lineWidth = 4;
  const cardX = 180;
  const cardY = 320;
  const cardSize = 840;
  ctx.fillRect(cardX, cardY, cardSize, cardSize);
  ctx.strokeRect(cardX, cardY, cardSize, cardSize);

  // Draw QR Image
  const qrImg = new Image();
  await new Promise((resolve, reject) => {
    qrImg.onload = resolve;
    qrImg.onerror = reject;
    qrImg.src = qrDataUrl;
  });
  ctx.drawImage(qrImg, cardX + 70, cardY + 70, cardSize - 140, cardSize - 140);

  // Instructions Header
  ctx.fillStyle = "#111111";
  ctx.font = "bold 26px 'Geist Mono', monospace";
  ctx.fillText("SCAN WITH CAMERA TO TAKE YOUR SPOT", canvas.width / 2, 1220);

  // Numbered Instructions Box
  const startY = 1290;
  const instructions = [
    "1. Scan with your phone camera — zero app download required.",
    "2. Keep the browser tab open and roam freely off-premise.",
    "3. Approach the desk immediately when entering the staging zone.",
  ];

  ctx.font = "20px 'Geist', sans-serif";
  ctx.fillStyle = "#444444";
  ctx.textAlign = "center";
  instructions.forEach((line, idx) => {
    ctx.fillText(line, canvas.width / 2, startY + idx * 46);
  });

  // Footer URL
  ctx.font = "bold 18px 'Geist Mono', monospace";
  ctx.fillStyle = "#888888";
  ctx.fillText(queueUrl, canvas.width / 2, 1530);

  ctx.font = "14px 'Geist Mono', monospace";
  ctx.fillStyle = "#AAAAAA";
  ctx.fillText("Powered by Q Engine • https://queue-engine.vercel.app", canvas.width / 2, 1600);

  // Download Trigger
  const a = document.createElement("a");
  a.download = `Q-Sign-${venueTitle.replace(/[^a-zA-Z0-9]/g, "-")}.png`;
  a.href = canvas.toDataURL("image/png");
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
