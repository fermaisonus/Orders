const SHEET_ID = "1cvFP-6mG0pcE-UgK5tXfywNTAAdC4YfXHRmzha0MJr8";
const MENU_SHEET = "Menu";
const MENU_HISTORY_SHEET = "Menu_History";
const ORDER_SHEET = "Orders";
const EMAIL_NOTIFY = "fermaison.us@gmail.com";
const MENU_HASH_PROPERTY = "FERMAISON_LAST_MENU_HASH";
const PAYMENT_CONFIRMED_PREFIX = "PAYMENT_CONFIRMED_";
const PAYMENT_KEYWORD_REGEX = /\bpaid\b/i;
const PICKUP_INSTRUCTIONS = "Thank you. Your payment has been received. Pickup location: Miami Design District (exact pin is shared day-before pickup). Please bring your order number at pickup.";
const MOTHERS_DAY_ITEM_KEYS = ["maman", "mom", "mama", "mamã"];

function onEdit(e) {
  try {
    if (!e || !e.range) return;

    const editedSheet = e.range.getSheet();
    if (editedSheet.getName() !== MENU_SHEET) return;

    // Ignore header edits and unrelated columns.
    if (e.range.getRow() <= 1) return;
    if (e.range.getColumn() > 5) return;

    const ss = e.source || SpreadsheetApp.openById(SHEET_ID);
    archiveMenuSnapshot_(ss);
  } catch (err) {
    console.error(`onEdit error: ${err}`);
  }
}

function setupMenuEditTrigger() {
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(trigger => {
    if (trigger.getHandlerFunction() === "onEdit") {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  ScriptApp.newTrigger("onEdit")
    .forSpreadsheet(SHEET_ID)
    .onEdit()
    .create();
}

function archiveMenuNow() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  archiveMenuSnapshot_(ss);
}

function setupPaidReplyTrigger() {
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(trigger => {
    const fn = trigger.getHandlerFunction();
    if (fn === "processPaidReplies" || fn === "processPaidRepliesNoon" || fn === "processPaidRepliesMidnight") {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  ScriptApp.newTrigger("processPaidRepliesNoon")
    .timeBased()
    .everyDays(1)
    .atHour(12)
    .nearMinute(0)
    .create();

  ScriptApp.newTrigger("processPaidRepliesMidnight")
    .timeBased()
    .everyDays(1)
    .atHour(0)
    .nearMinute(0)
    .create();
}

function processPaidRepliesNoon() {
  processPaidReplies();
}

function processPaidRepliesMidnight() {
  processPaidReplies();
}

function processPaidReplies() {
  const query = `to:${EMAIL_NOTIFY} subject:"New Order -" newer_than:14d`;
  const threads = GmailApp.search(query, 0, 100);
  if (!threads.length) return;

  const ss = SpreadsheetApp.openById(SHEET_ID);
  const orderSheet = ss.getSheetByName(ORDER_SHEET);
  if (!orderSheet) throw new Error("Orders sheet not found");

  const props = PropertiesService.getScriptProperties();

  threads.forEach(thread => {
    const subject = thread.getFirstMessageSubject() || "";
    const orderNumber = extractOrderNumber_(subject);
    if (!orderNumber) return;

    const paymentKey = `${PAYMENT_CONFIRMED_PREFIX}${orderNumber}`;
    if (props.getProperty(paymentKey)) return;

    const messages = thread.getMessages();
    if (!messages.length) return;

    const hasPaidReply = messages.slice(1).some(msg => {
      const body = msg.getPlainBody() || "";
      return PAYMENT_KEYWORD_REGEX.test(body);
    });

    if (!hasPaidReply) return;

    const orderRecord = findOrderRecord_(orderSheet, orderNumber);
    if (!orderRecord || !orderRecord.email) return;

    const customerHtml = `
      <div style="font-family:Courier New, monospace; max-width:650px;">
        <h2>payment received</h2>
        <p><strong>order number:</strong> ${orderRecord.orderNumber}</p>
        <p><strong>name:</strong> ${orderRecord.name || "customer"}</p>
        <p><strong>email:</strong> ${orderRecord.email}</p>
        <p><strong>phone:</strong> ${orderRecord.phone || "n/a"}</p>
        <p><strong>pickup:</strong> ${orderRecord.pickupDisplay || orderRecord.pickup || "see original confirmation"}</p>
        <hr>
        <p>${PICKUP_INSTRUCTIONS}</p>
      </div>
    `;

    MailApp.sendEmail({
      to: orderRecord.email,
      subject: `Payment received - ${orderRecord.orderNumber}`,
      htmlBody: customerHtml,
      name: "Fermaison"
    });

    props.setProperty(paymentKey, new Date().toISOString());
  });
}

function archiveMenuSnapshot_(ss) {
  const menuSheet = ss.getSheetByName(MENU_SHEET);
  if (!menuSheet) throw new Error("Menu sheet not found");

  const historySheet = getOrCreateHistorySheet_(ss);
  const menuLastRow = menuSheet.getLastRow();
  if (menuLastRow <= 1) return;

  const rawMenuRows = menuSheet.getRange(2, 1, menuLastRow - 1, 5).getValues();
  const menuRows = rawMenuRows
    .map(([name, description, price, section, active]) => [
      String(name || "").trim(),
      String(description || "").trim(),
      Number(price || 0),
      normalizeSectionValue_(section, name),
      normalizeActiveValue_(active) ? "true" : "false"
    ])
    .filter(([name]) => name);

  if (!menuRows.length) return;

  const snapshotHash = buildMenuHash_(menuRows);
  const props = PropertiesService.getScriptProperties();
  const previousHash = props.getProperty(MENU_HASH_PROPERTY);
  if (snapshotHash === previousHash) return;

  const now = new Date();
  const tz = Session.getScriptTimeZone() || "America/New_York";
  const savedAt = Utilities.formatDate(now, tz, "yyyy-MM-dd HH:mm:ss");
  const version = `menu-${Utilities.formatDate(now, tz, "yyyyMMdd-HHmmss")}`;

  const rowsToAppend = menuRows.map(([name, description, price, section, active]) => [
    version,
    savedAt,
    name,
    price,
    description,
    section,
    active
  ]);

  historySheet.getRange(
    historySheet.getLastRow() + 1,
    1,
    rowsToAppend.length,
    rowsToAppend[0].length
  ).setValues(rowsToAppend);

  props.setProperty(MENU_HASH_PROPERTY, snapshotHash);
}

function getOrCreateHistorySheet_(ss) {
  let historySheet = ss.getSheetByName(MENU_HISTORY_SHEET);
  if (!historySheet) {
    historySheet = ss.insertSheet(MENU_HISTORY_SHEET);
  }

  if (historySheet.getLastRow() === 0) {
    historySheet.appendRow(["menu_version", "saved_at", "item_name", "price", "description", "section", "active"]);
  }

  return historySheet;
}

function buildMenuHash_(menuRows) {
  const payload = JSON.stringify(menuRows);
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, payload);
  return Utilities.base64EncodeWebSafe(digest);
}

function extractOrderNumber_(subject) {
  const match = String(subject || "").match(/F-\d{4}-\d+/i);
  return match ? match[0].toUpperCase() : "";
}

function slugifyItemName_(name) {
  return String(name || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function findOrderRecord_(orderSheet, orderNumber) {
  const lastRow = orderSheet.getLastRow();
  if (lastRow <= 1) return null;

  const lastColumn = orderSheet.getLastColumn();
  const rows = orderSheet.getRange(2, 1, lastRow - 1, lastColumn).getValues();
  const target = rows.find(row => String(row[0] || "").toUpperCase() === orderNumber);
  if (!target) return null;

  return {
    orderNumber: String(target[0] || ""),
    name: String(target[2] || ""),
    email: String(target[3] || ""),
    phone: String(target[4] || ""),
    pickup: String(target[target.length - 14] || target[target.length - 9] || ""),
    pickupDisplay: String(target[target.length - 12] || target[target.length - 7] || "")
  };
}

function doGet(e) {
  try {
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const sheet = ss.getSheetByName(MENU_SHEET);
    if (!sheet) throw new Error("Menu sheet not found");

    const data = sheet.getDataRange().getValues();
    const json = data.slice(1).map(row => ({
      name: String(row[0] || "").trim(),
      description: String(row[1] || "").trim(),
      price: Number(row[2] || 0),
      section: normalizeSectionValue_(row[3], row[0]),
      active: normalizeActiveValue_(row[4])
    })).filter(item => item.name);

    return ContentService
      .createTextOutput(JSON.stringify(json))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ error: String(err) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function doPost(e) {
  let cache;
  let cacheKey = "";
  try {
    const data = JSON.parse((e.postData && e.postData.contents) || "{}");
    const submissionId = String(data.submissionId || "").trim();
    cache = CacheService.getScriptCache();
    cacheKey = submissionId ? `order_submission_${submissionId}` : "";

    if (cacheKey) {
      const cached = cache.get(cacheKey);
      if (cached) {
        let previous = {};
        try {
          previous = JSON.parse(cached);
        } catch (parseErr) {
          previous = {};
        }

        if (previous.result === "success") {
          return ContentService
            .createTextOutput(JSON.stringify({
              result: "success",
              orderNumber: previous.orderNumber || "",
              total: previous.total || data.total || "0.00",
              duplicate: true
            }))
            .setMimeType(ContentService.MimeType.JSON);
        }

        return ContentService
          .createTextOutput(JSON.stringify({
            result: "error",
            message: "Order is already being processed. Please wait."
          }))
          .setMimeType(ContentService.MimeType.JSON);
      }

      cache.put(cacheKey, JSON.stringify({ result: "processing" }), 300);
    }

    const ss = SpreadsheetApp.openById(SHEET_ID);
    const sheet = ss.getSheetByName(ORDER_SHEET);
    const menuSheet = ss.getSheetByName(MENU_SHEET);

    if (!sheet) throw new Error("Orders sheet not found");
    if (!menuSheet) throw new Error("Menu sheet not found");

    const nextRow = sheet.getLastRow() + 1;
    const today = new Date();
    const month = String(today.getMonth() + 1).padStart(2, "0");
    const day = String(today.getDate()).padStart(2, "0");
    const orderNumber = `F-${month}${day}-${nextRow}`;

    const menuLastRow = menuSheet.getLastRow();
    const menuData = menuLastRow > 1
      ? menuSheet.getRange(2, 1, menuLastRow - 1, 5).getValues()
      : [];

    const activeMenuData = menuData.filter(([name, description, price, section, active]) => {
      return String(name || "").trim() && normalizeActiveValue_(active);
    });
    const submittedItems = Array.isArray(data.items) ? data.items : [];
    const qtyByKey = {};
    submittedItems.forEach(item => {
      const key = String(item.key || slugifyItemName_(item.name)).trim();
      if (key) qtyByKey[key] = parseInt(item.qty, 10) || 0;
    });

    const pickupDate = data.pickupDate || "";
    const pickupDisplay = data.pickupDisplay || (pickupDate ? `${data.pickup} (${pickupDate})` : data.pickup);
    const fulfillmentNote = data.fulfillmentNote || "this order is scheduled for the upcoming pickup window.";
    const regularPickup = data.regularPickup || "";
    const regularPickupDate = data.regularPickupDate || "";
    const mothersDayPickup = data.mothersDayPickup || "";
    const mothersDayPickupDate = data.mothersDayPickupDate || "";
    const apartment = data.apartment || "";

    let calculatedTotal = 0;
    activeMenuData.forEach(([name, description, price]) => {
      const key = slugifyItemName_(name);
      const legacyKey = String(name).toLowerCase();
      const qty = submittedItems.length
        ? (qtyByKey[key] || 0)
        : (parseInt(data[legacyKey], 10) || 0);
      calculatedTotal += qty * (parseFloat(price) || 0);
    });
    data.total = calculatedTotal.toFixed(2);

    const row = [orderNumber, new Date(), data.name, data.email, data.phone];
    activeMenuData.forEach(([name]) => {
      const key = slugifyItemName_(name);
      const legacyKey = String(name).toLowerCase();
      const qty = submittedItems.length
        ? (qtyByKey[key] || 0)
        : (parseInt(data[legacyKey], 10) || 0);
      row.push(qty);
    });
    row.push(
      data.total,
      data.pickup,
      pickupDate,
      pickupDisplay,
      data.payment,
      data.allergies,
      data.requests,
      data.newsletter,
      data.supperclub,
      data.feedback,
      regularPickup,
      regularPickupDate,
      mothersDayPickup,
      mothersDayPickupDate,
      apartment
    );
    sheet.appendRow(row);

    let orderedItemsHtml = "";
    activeMenuData.forEach(([name]) => {
      const key = slugifyItemName_(name);
      const legacyKey = String(name).toLowerCase();
      const qty = submittedItems.length
        ? (qtyByKey[key] || 0)
        : (parseInt(data[legacyKey], 10) || 0);
      if (qty > 0) orderedItemsHtml += `<li>${String(name).toLowerCase()} x${qty}</li>`;
    });

    const handles = {
      "apple pay": "applepay@fermaison.us",
      "cash app": "$fermaison",
      venmo: "@fermaison",
      zelle: "fermaison@gmail.com"
    };
    const paymentHandle = handles[data.payment] || "";

    const customerEmailBody = `
      <div style="font-family:Courier New, monospace; max-width:600px;">
        <h2>thank you for your order!</h2>
        <p><strong>order number:</strong> ${orderNumber}</p>
        <h3>items ordered</h3>
        <ul>${orderedItemsHtml || "<li>none</li>"}</ul>
        <p><strong>total:</strong> $${data.total}</p>
        <p><strong>pickup:</strong> ${pickupDisplay}</p>
        ${regularPickup ? `<p><strong>regular pickup:</strong> ${regularPickup}${regularPickupDate ? ` (${regularPickupDate})` : ""}</p>` : ""}
        ${mothersDayPickup ? `<p><strong>mother's day pickup/delivery:</strong> ${mothersDayPickup}${mothersDayPickupDate ? ` (${mothersDayPickupDate})` : ""}</p>` : ""}
        ${apartment ? `<p><strong>Watermarc apartment:</strong> ${apartment}</p>` : ""}
        <p><strong>schedule:</strong> ${fulfillmentNote}</p>
        <p><strong>payment method:</strong> ${data.payment}</p>
        <p><strong>send payment to:</strong> ${paymentHandle}</p>
      </div>
    `;

    MailApp.sendEmail({
      to: data.email,
      subject: `Fermaison Order #${orderNumber}`,
      htmlBody: customerEmailBody,
      name: "Fermaison",
      replyTo: EMAIL_NOTIFY
    });

    const adminEmailBody = `
      <div style="font-family:Courier New, monospace; max-width:700px;">
        <h2>new order placed</h2>
        <p><strong>order number:</strong> ${orderNumber}</p>
        <p><strong>name:</strong> ${data.name}</p>
        <p><strong>email:</strong> ${data.email}</p>
        <p><strong>phone:</strong> ${data.phone}</p>
        <ul>${orderedItemsHtml || "<li>none</li>"}</ul>
        <p><strong>total:</strong> $${data.total}</p>
        <p><strong>pickup:</strong> ${pickupDisplay}</p>
        ${regularPickup ? `<p><strong>regular pickup:</strong> ${regularPickup}${regularPickupDate ? ` (${regularPickupDate})` : ""}</p>` : ""}
        ${mothersDayPickup ? `<p><strong>mother's day pickup/delivery:</strong> ${mothersDayPickup}${mothersDayPickupDate ? ` (${mothersDayPickupDate})` : ""}</p>` : ""}
        ${apartment ? `<p><strong>Watermarc apartment:</strong> ${apartment}</p>` : ""}
        <p><strong>schedule:</strong> ${fulfillmentNote}</p>
      </div>
    `;

    MailApp.sendEmail({
      to: EMAIL_NOTIFY,
      subject: `New Order - ${orderNumber}`,
      htmlBody: adminEmailBody,
      name: "Fermaison Orders"
    });

    if (cacheKey) {
      cache.put(cacheKey, JSON.stringify({
        result: "success",
        orderNumber: orderNumber,
        total: data.total
      }), 21600);
    }

    return ContentService
      .createTextOutput(JSON.stringify({
        result: "success",
        orderNumber: orderNumber,
        total: data.total
      }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    if (cache && cacheKey) {
      cache.remove(cacheKey);
    }
    return ContentService
      .createTextOutput(JSON.stringify({ result: "error", message: String(err) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function normalizeActiveValue_(value) {
  if (value === "" || value === null || typeof value === "undefined") return true;
  if (typeof value === "boolean") return value;
  return String(value).trim().toLowerCase() === "true";
}

function normalizeSectionValue_(value, name) {
  const section = String(value || "regular").trim().toLowerCase();
  const compactSection = section.replace(/['’_\-\s]/g, "");
  const nameKey = String(name || "").trim().toLowerCase();
  if (compactSection.indexOf("mother") !== -1 || MOTHERS_DAY_ITEM_KEYS.indexOf(nameKey) !== -1) {
    return "mothers-day";
  }
  return section;
}
