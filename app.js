const WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbxAhByd30dfj83zNLLl-KBvHNuYn4ksaVCzWMBHsf6gTnV5Aaf86yP6IJyhUg4YSm3v/exec';
const MENU_CACHE_KEY = 'fermaison_menu_cache_v3';
const MENU_CACHE_TTL_MS = 10 * 60 * 1000;

const MOTHERS_DAY_END = new Date('2026-05-07T23:59:59-04:00');
const MOTHERS_DAY_PICKUP_DATE = new Date('2026-05-10T12:00:00-04:00');

const menuContainer = document.getElementById('menuContainer');
const totalEl = document.getElementById('total');
const breadForm = document.getElementById('breadForm');
const submitBtn = breadForm.querySelector('button[type="submit"]');
const submitStatusEl = document.getElementById('submitStatus');
const mothersDaySection = document.getElementById('mothersDaySection');
const mothersDayContainer = document.getElementById('mothersDayItems');

let menuQtys = [];
let menuItemsNames = [];
let isSubmitting = false;

const MOTHERS_DAY_ITEM_KEYS = ['maman', 'mom', 'mama', 'mamã'];

function isMothersDayActive() {
    return new Date() <= MOTHERS_DAY_END;
}

function buildSubmissionId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
        return window.crypto.randomUUID();
    }
    return `sub_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function setSubmitState(submitting, message) {
    if (submitBtn) {
        submitBtn.disabled = submitting;
        submitBtn.textContent = submitting ? 'submitting order...' : 'submit order';
    }
    if (submitStatusEl) {
        submitStatusEl.textContent = message || '';
    }
    isSubmitting = submitting;
}

function calculateTotal() {
    let total = 0;
    menuQtys.forEach(q => {
        const qty = parseInt(q.value, 10) || 0;
        total += qty * parseFloat(q.dataset.price || '0');
    });
    totalEl.textContent = total.toFixed(2);
}

function getNextPickupDate(pickupText) {
    const isSundayPickup = String(pickupText || '').toLowerCase().startsWith('sunday');
    if (isSundayPickup && isMothersDayActive()) {
        return formatLongDate(MOTHERS_DAY_PICKUP_DATE);
    }

    const m = String(pickupText || '').toLowerCase().match(/^(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
    if (!m) return '';

    const dayMap = {
        sunday: 0,
        monday: 1,
        tuesday: 2,
        wednesday: 3,
        thursday: 4,
        friday: 5,
        saturday: 6
    };

    const now = new Date();
    const targetDay = dayMap[m[1]];
    let daysAhead = (targetDay - now.getDay() + 7) % 7;
    if (daysAhead === 0) daysAhead = 7;

    const pickupDate = new Date(now);
    pickupDate.setDate(now.getDate() + daysAhead);

    return formatLongDate(pickupDate);
}

function formatLongDate(date) {
    return new Intl.DateTimeFormat('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        year: 'numeric'
    }).format(date);
}

function getFulfillmentNote() {
    return isMothersDayActive()
        ? "this order is scheduled for mother's day pickup."
        : "this order is scheduled for the selected pickup window.";
}

function buildPaymentConfig(paymentMethod, total, orderNumber) {
    const amount = Number(total || 0).toFixed(2);
    const note = `Fermaison order ${orderNumber}`;
