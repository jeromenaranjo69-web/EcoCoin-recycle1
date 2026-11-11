"use strict";

// EcoCoin browser app. Scanner reads EcoCoin QR labels, then adds the
// decoded quantity to the same counts used by manual input and the website.
const rates = { plastic: 1.00, cans: 2.00, cardboard: 0.50 };
const MAX_ITEMS = 100;
let counts = { plastic: 0, cans: 0, cardboard: 0 };
let cameraStream = null;
let scanLoopActive = false;
let lastScannedValue = "";
let lastScanTime = 0;

const $ = (id) => document.getElementById(id);
const money = (amount) => "₱" + amount.toFixed(2);

function showMessage(message, success = false) {
  $("message").textContent = message;
  $("message").classList.toggle("success", success);
}
function showScanStatus(message, type = "") {
  $("scanStatus").textContent = message;
  $("scanStatus").className = "scan-status " + type;
}
function getMaterialTotal(material) { return counts[material] * rates[material]; }
function getTotalItems() { return counts.plastic + counts.cans + counts.cardboard; }
function getTotalReward() {
  return Object.keys(counts).reduce((sum, material) => sum + getMaterialTotal(material), 0);
}

function addMaterial(material, quantity, source = "Manual input") {
  if (!Object.prototype.hasOwnProperty.call(counts, material)) {
    showMessage("Unknown material. Use plastic, cans, or cardboard.");
    return false;
  }
  if (!Number.isInteger(quantity) || quantity < 1) {
    showMessage("Quantity must be a whole number greater than zero.");
    return false;
  }
  const remaining = MAX_ITEMS - counts[material];
  if (quantity > remaining) {
    showMessage(`Cannot add ${quantity}. Only ${remaining} ${material} item(s) remaining before the 100-item limit.`);
    return false;
  }
  counts[material] += quantity;
  updateDisplay();
  showMessage(`${quantity} ${material} item(s) added via ${source}.`, true);
  return true;
}

function addEnteredQuantity(material) {
  if (!manualInputUnlocked) {
    showMessage("Upload a photo and detect recyclable materials first to unlock Manual Material Input.");
    return;
  }
  const input = $(material + "Input");
  const quantity = Number(input.value);
  if (addMaterial(material, quantity, "manual input")) input.value = "";
}

function changeCount(material, amount) {
  if (!manualInputUnlocked) {
    showMessage("Upload a photo and detect recyclable materials first to unlock Manual Material Input.");
    return;
  }
  if (!Object.prototype.hasOwnProperty.call(counts, material)) return;
  const next = counts[material] + amount;
  if (next < 0 || next > MAX_ITEMS) return;
  counts[material] = next;
  showMessage("");
  updateDisplay();
}

function updateDisplay() {
  const ids = {
    plastic: ["plasticCount", "plasticAmount", "summaryPlastic"],
    cans: ["cansCount", "cansAmount", "summaryCans"],
    cardboard: ["cardboardCount", "cardboardAmount", "summaryCardboard"]
  };
  for (const material of Object.keys(counts)) {
    const [countId, amountId, summaryId] = ids[material];
    const subtotal = getMaterialTotal(material);
    $(countId).textContent = counts[material];
    $(amountId).textContent = money(subtotal);
    $(summaryId).textContent = money(subtotal);
  }
  const total = getTotalReward();
  $("displayTotal").textContent = money(total);
  $("summaryTotal").textContent = money(total);
  $("displayItems").textContent = getTotalItems();
  $("confirmBtn").disabled = getTotalItems() === 0;

  document.querySelectorAll("[data-material]").forEach((button) => {
    const material = button.dataset.material;
    const change = Number(button.dataset.change);
    button.disabled = !manualInputUnlocked ||
                       (change === -1 && counts[material] === 0) ||
                       (change === 1 && counts[material] === MAX_ITEMS);
  });

  document.querySelectorAll("[data-add]").forEach((button) => {
    button.disabled = !manualInputUnlocked;
  });
  ["plastic", "cans", "cardboard"].forEach((material) => {
    $(material + "Input").disabled = !manualInputUnlocked;
  });
  const lockNotice = $("manualInputLockNotice");
  if (lockNotice) {
    lockNotice.textContent = manualInputUnlocked
      ? "✓ Photo detection completed. Manual Material Input is now unlocked."
      : "🔒 Upload a photo and successfully detect recyclable materials to unlock manual input.";
    lockNotice.classList.toggle("success", manualInputUnlocked);
  }
}

// Accepted QR payloads:
// ECOCOIN:plastic:1
// {"material":"plastic","quantity":1}
function parseEcoCoinQR(rawValue) {
  const value = String(rawValue).trim();
  if (value.startsWith("{")) {
    try {
      const data = JSON.parse(value);
      return { material: String(data.material || "").toLowerCase(), quantity: Number(data.quantity) };
    } catch (_) {
      return null;
    }
  }
  const match = value.match(/^ECOCOIN:(plastic|cans|cardboard):(\d+)$/i);
  if (!match) return null;
  return { material: match[1].toLowerCase(), quantity: Number(match[2]) };
}

async function startScanner() {
  if (!("BarcodeDetector" in window)) {
    showScanStatus("This browser does not support built-in QR scanning. Use manual quantity input, or open this site in an updated Chrome browser.", "error");
    return;
  }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showScanStatus("Camera access is unavailable. Use HTTPS or localhost, then allow camera permission.", "error");
    return;
  }

  try {
    const detector = new BarcodeDetector({ formats: ["qr_code"] });
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" } },
      audio: false
    });
    const video = $("cameraPreview");
    video.srcObject = cameraStream;
    video.hidden = false;
    $("scanPlaceholder").hidden = true;
    await video.play();

    scanLoopActive = true;
    $("startScanBtn").disabled = true;
    $("stopScanBtn").disabled = false;
    showScanStatus("Camera active. Point it at an EcoCoin QR label.", "success");

    let lastDetectionAt = 0;
    const scanFrame = async (timestamp) => {
      if (!scanLoopActive) return;
      // Limit detector work to about 5 scans per second to reduce mobile CPU use.
      if (timestamp - lastDetectionAt >= 200) {
        lastDetectionAt = timestamp;
        try {
          if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
            const codes = await detector.detect(video);
            if (codes.length) handleScannedCode(codes[0].rawValue);
          }
        } catch (error) {
          // Keep the camera running; transient frame-detection errors can occur.
        }
      }
      if (scanLoopActive) requestAnimationFrame(scanFrame);
    };
    requestAnimationFrame(scanFrame);
  } catch (error) {
    stopScanner();
    showScanStatus("Could not open camera. Allow camera permission and use HTTPS or localhost.", "error");
  }
}

function handleScannedCode(rawValue) {
  const now = Date.now();
  // Prevent the same label from being added repeatedly while it remains in view.
  if (rawValue === lastScannedValue && now - lastScanTime < 2500) return;

  const parsed = parseEcoCoinQR(rawValue);
  if (!parsed) {
    showScanStatus("QR detected, but it is not a valid EcoCoin label. Expected ECOCOIN:plastic:1", "error");
    lastScannedValue = rawValue;
    lastScanTime = now;
    return;
  }

  lastScannedValue = rawValue;
  lastScanTime = now;
  const added = addMaterial(parsed.material, parsed.quantity, "QR scanner");
  if (added) {
    showScanStatus(`Accepted QR: ${parsed.quantity} ${parsed.material} item(s) added. Scan another label when ready.`, "success");
  } else {
    showScanStatus("QR read, but quantity was not added. Check the 100-item limit.", "error");
  }
}

function stopScanner() {
  scanLoopActive = false;
  if (cameraStream) {
    cameraStream.getTracks().forEach(track => track.stop());
    cameraStream = null;
  }
  const video = $("cameraPreview");
  video.pause();
  video.srcObject = null;
  video.hidden = true;
  $("scanPlaceholder").hidden = false;
  $("startScanBtn").disabled = false;
  $("stopScanBtn").disabled = true;
}


// Photo-assisted object detection. COCO-SSD is a general object detector,
// not a recycling classifier; every suggested material must be reviewed.
let photoModel = null;
let photoDetections = [];
let selectedPhotoUrl = null;
// Manual quantity controls stay locked until a photo produces at least one detection.
let manualInputUnlocked = false;

function setPhotoStatus(message, type = "") {
  $("photoStatus").textContent = message;
  $("photoStatus").className = "scan-status " + type;
}

async function loadPhotoModel() {
  if (photoModel) return photoModel;
  if (!window.tf || !window.cocoSsd) {
    throw new Error("AI model library could not load. Check your internet connection, then reload the app.");
  }
  setPhotoStatus("Loading AI detection model. Please wait...", "");
  await window.tf.ready();
  photoModel = await window.cocoSsd.load({ base: "lite_mobilenet_v2" });
  return photoModel;
}

function suggestedMaterial(className) {
  const label = String(className).toLowerCase();
  if (label === "bottle") return "plastic";
  if (label === "book") return "cardboard";
  return "";
}

function renderPhotoDetections() {
  const container = $("detectedItems");
  container.replaceChildren();
  photoDetections.forEach((item, index) => {
    const row = document.createElement("div");
    row.className = "detected-row";

    const info = document.createElement("div");
    const name = document.createElement("strong");
    name.textContent = `${index + 1}. ${item.className}`;
    const confidence = document.createElement("small");
    confidence.textContent = `AI confidence: ${Math.round(item.score * 100)}%`;
    info.append(name, confidence);

    const select = document.createElement("select");
    select.setAttribute("aria-label", `Material for detected ${item.className}`);
    [
      ["", "Choose material..."],
      ["plastic", "Plastic Bottle — ₱1.00"],
      ["cans", "Aluminum Can — ₱2.00"],
      ["cardboard", "Cardboard — ₱0.50"]
    ].forEach(([value, label]) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      select.append(option);
    });
    const suggestion = suggestedMaterial(item.className);
    select.value = suggestion;
    select.addEventListener("change", () => {
      item.material = select.value;
      updatePhotoAddButton();
    });
    item.material = suggestion;
    row.append(info, select);
    container.append(row);
  });
  $("photoResults").hidden = photoDetections.length === 0;
  updatePhotoAddButton();
}

function updatePhotoAddButton() {
  const selected = photoDetections.filter(item => item.material);
  $("addDetectedBtn").disabled = selected.length === 0;
  $("addDetectedBtn").textContent = `Add Confirmed Items (${selected.length})`;
}

async function detectPhotoMaterials() {
  const image = $("photoPreview");
  if (!image.src || image.hidden) return;
  $("detectPhotoBtn").disabled = true;
  $("photoResults").hidden = true;
  try {
    const model = await loadPhotoModel();
    setPhotoStatus("Analyzing photo...", "");
    const predictions = await model.detect(image, 20, 0.35);
    photoDetections = predictions.map(prediction => ({
      className: prediction.class,
      score: prediction.score,
      material: suggestedMaterial(prediction.class)
    }));
    renderPhotoDetections();
    if (!photoDetections.length) {
      manualInputUnlocked = false;
      updateDisplay();
      setPhotoStatus("No clear objects detected. Manual input remains locked. Try a brighter, closer photo with less background clutter.", "error");
    } else {
      manualInputUnlocked = true;
      updateDisplay();
      setPhotoStatus(`Found ${photoDetections.length} object(s). Manual Material Input is now unlocked. Review the suggested material for each detected object.`, "success");
    }
  } catch (error) {
    console.error("Photo detection error:", error);
    setPhotoStatus(error.message || "Photo detection failed. Please try again.", "error");
  } finally {
    $("detectPhotoBtn").disabled = false;
  }
}

function addDetectedMaterials() {
  const chosen = photoDetections.filter(item => item.material);
  if (!chosen.length) {
    setPhotoStatus("Choose a material for at least one detected object.", "error");
    return;
  }
  // Validate the entire batch first so the photo action cannot partially add items.
  const additions = { plastic: 0, cans: 0, cardboard: 0 };
  chosen.forEach(item => additions[item.material]++);
  const exceeded = Object.keys(additions).find(material =>
    counts[material] + additions[material] > MAX_ITEMS
  );
  if (exceeded) {
    setPhotoStatus(`Cannot add all detected items. ${exceeded} has only ${MAX_ITEMS - counts[exceeded]} slot(s) remaining.`, "error");
    return;
  }
  Object.keys(additions).forEach(material => {
    counts[material] += additions[material];
  });
  updateDisplay();
  const totalAdded = chosen.length;
  photoDetections = [];
  $("photoResults").hidden = true;
  setPhotoStatus(`${totalAdded} confirmed item(s) added to your transaction.`, "success");
  showMessage(`${totalAdded} detected item(s) added from photo.`, true);
}

function clearPhoto() {
  if (selectedPhotoUrl) URL.revokeObjectURL(selectedPhotoUrl);
  selectedPhotoUrl = null;
  $("materialPhoto").value = "";
  $("photoPreview").removeAttribute("src");
  $("photoPreview").hidden = true;
  $("photoResults").hidden = true;
  $("detectedItems").replaceChildren();
  photoDetections = [];
  manualInputUnlocked = false;
  $("detectPhotoBtn").disabled = true;
  $("addDetectedBtn").disabled = true;
  updateDisplay();
  setPhotoStatus("Select a clear photo to begin. Manual Material Input is locked until detection succeeds.", "");
}

function handlePhotoSelected(event) {
  const file = event.target.files && event.target.files[0];
  clearPhoto();
  if (!file) return;
  if (!file.type.startsWith("image/")) {
    setPhotoStatus("Please select a valid image file.", "error");
    return;
  }
  if (file.size > 12 * 1024 * 1024) {
    setPhotoStatus("Photo is too large. Please choose an image under 12 MB.", "error");
    return;
  }
  selectedPhotoUrl = URL.createObjectURL(file);
  const image = $("photoPreview");
  image.onload = () => {
    image.hidden = false;
    $("detectPhotoBtn").disabled = false;
    setPhotoStatus("Photo ready. Tap Detect Materials.", "success");
  };
  image.onerror = () => setPhotoStatus("Could not read this photo. Please choose another image.", "error");
  image.src = selectedPhotoUrl;
}


function paymentChanged() {
  const isCashless = $("payment").value === "Cashless";
  $("cashlessFields").hidden = !isCashless;
  if (!isCashless) $("account").value = "";
  showMessage("");
}

function confirmTransaction() {
  const totalItems = getTotalItems();
  const totalReward = getTotalReward();
  if (totalItems === 0) {
    showMessage("Please add recyclable materials first.");
    return;
  }

  const paymentMethod = $("payment").value;
  let accountInfo = "";
  if (paymentMethod === "Cashless") {
    const wallet = $("wallet").value;
    const account = $("account").value.trim();
    if (!/^09\d{9}$/.test(account)) {
      showMessage("Please enter a valid 11-digit mobile number starting with 09.");
      $("account").focus();
      return;
    }
    accountInfo = wallet + " - " + account;
  }

  $("receiptID").textContent = "ECO-" + Date.now().toString().slice(-8);
  $("receiptDate").textContent = new Date().toLocaleString();
  $("receiptPlastic").textContent = `${counts.plastic} × ${money(rates.plastic)} = ${money(getMaterialTotal("plastic"))}`;
  $("receiptCans").textContent = `${counts.cans} × ${money(rates.cans)} = ${money(getMaterialTotal("cans"))}`;
  $("receiptCardboard").textContent = `${counts.cardboard} × ${money(rates.cardboard)} = ${money(getMaterialTotal("cardboard"))}`;
  $("receiptItems").textContent = totalItems;
  $("receiptPayment").textContent = paymentMethod;
  $("receiptAccount").textContent = accountInfo;
  $("receiptAccountRow").hidden = paymentMethod !== "Cashless";
  $("receiptTotal").textContent = money(totalReward);
  $("receiptModal").hidden = false;
  showMessage("");
}

function resetMachine() {
  counts = { plastic: 0, cans: 0, cardboard: 0 };
  ["plasticInput", "cansInput", "cardboardInput"].forEach(id => $(id).value = "");
  $("payment").value = "Cash";
  $("wallet").value = "GCash";
  $("account").value = "";
  $("cashlessFields").hidden = true;
  showMessage("");
  updateDisplay();
}

function closeReceipt() {
  $("receiptModal").hidden = true;
  resetMachine();
}

document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll("[data-material]").forEach(button => {
    button.addEventListener("click", () => changeCount(button.dataset.material, Number(button.dataset.change)));
  });
  document.querySelectorAll("[data-add]").forEach(button => {
    button.addEventListener("click", () => addEnteredQuantity(button.dataset.add));
  });
  ["plastic", "cans", "cardboard"].forEach(material => {
    $(material + "Input").addEventListener("keydown", event => {
      if (event.key === "Enter") addEnteredQuantity(material);
    });
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden && cameraStream) stopScanner();
  });

  $("materialPhoto").addEventListener("change", handlePhotoSelected);
  $("detectPhotoBtn").addEventListener("click", detectPhotoMaterials);
  $("clearPhotoBtn").addEventListener("click", clearPhoto);
  $("addDetectedBtn").addEventListener("click", addDetectedMaterials);

  $("startScanBtn").addEventListener("click", startScanner);
  $("stopScanBtn").addEventListener("click", stopScanner);
  $("payment").addEventListener("change", paymentChanged);
  $("confirmBtn").addEventListener("click", confirmTransaction);
  $("resetBtn").addEventListener("click", resetMachine);
  $("doneBtn").addEventListener("click", closeReceipt);
  $("printBtn").addEventListener("click", () => window.print());

  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
    navigator.serviceWorker.register("./service-worker.js").catch(() => {
      console.info("Service worker registration was not available.");
    });
  }

  updateDisplay();
  paymentChanged();
});
