const WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbxAhByd30dfj83zNLLl-KBvHNuYn4ksaVCzWMBHsf6gTnV5Aaf86yP6IJyhUg4YSm3v/exec';
const MENU_CACHE_KEY = 'fermaison_menu_cache_v6';
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
const regularPickupInput = document.getElementById('regularPickup');
const mothersDayPickupInput = document.getElementById('mothersDayPickup');
const apartmentInput = document.getElementById('apartment');
const watermarcDetails = document.getElementById('watermarcDetails');

let menuQtys = [];
let menuItemsNames = [];
let isSubmitting = false;

const MOTHERS_DAY_ITEM_KEYS = ['maman', 'mom', 'mama', 'mamã'];

function slugifyItemName(name) {
    return String(name || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

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
    updateFulfillmentRequirements();
}

function hasSelectedItemsInSection(section) {
    return Array.from(menuQtys).some(input => {
        const qty = parseInt(input.value, 10) || 0;
        return qty > 0 && input.dataset.section === section;
    });
}

function isWatermarcSelected() {
    return String(mothersDayPickupInput?.value || '').toLowerCase().includes('watermarc');
}

function updateFulfillmentRequirements() {
    const hasRegularItems = hasSelectedItemsInSection('regular');
    const hasMothersDayItems = hasSelectedItemsInSection('mothers-day');
    const watermarcSelected = isWatermarcSelected();

    if (regularPickupInput) {
        regularPickupInput.required = hasRegularItems;
    }

    if (mothersDayPickupInput) {
        mothersDayPickupInput.required = hasMothersDayItems;
    }

    if (apartmentInput) {
        apartmentInput.required = hasMothersDayItems && watermarcSelected;
    }

    if (watermarcDetails) {
        watermarcDetails.hidden = !watermarcSelected;
    }
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
    const encodedNote = encodeURIComponent(note);

    const configs = {
        'cash app': {
            deepLink: `cashapp://pay?cashtag=fermaison&amount=${amount}&note=${encodedNote}`,
            webLink: `https://cash.app/$fermaison/${amount}`,
            supportsPrefill: true
        },
        venmo: {
            deepLink: `venmo://paycharge?txn=pay&recipients=fermaison&amount=${amount}&note=${encodedNote}`,
            webLink: `https://venmo.com/fermaison?txn=pay&amount=${amount}&note=${encodedNote}`,
            supportsPrefill: true
        },
        'apple pay': {
            deepLink: '',
            webLink: '',
            supportsPrefill: false
        },
        zelle: {
            deepLink: '',
            webLink: '',
            supportsPrefill: false
        }
    };

    return configs[paymentMethod] || { deepLink: '', webLink: '', supportsPrefill: false };
}

function buildSmsLink(paymentMethod, handle, amount, orderNumber) {
    const body = encodeURIComponent(
        `Hi, I placed Fermaison order ${orderNumber}. Paying $${amount} via ${paymentMethod} to ${handle}.`
    );
    return `sms:?&body=${body}`;
}

function launchPayment(deepLink, webLink) {
    if (!deepLink && !webLink) return;
    if (deepLink) {
        window.location.href = deepLink;
        if (webLink) {
            setTimeout(() => {
                window.location.href = webLink;
            }, 1200);
        }
        return;
    }
    window.location.href = webLink;
}

function normalizeMenuItem(item) {
    const rawSection = String(item.section || 'regular').trim().toLowerCase();
    const compactSection = rawSection.replace(/['’_\-\s]/g, '');
    const nameKey = String(item.name || '').trim().toLowerCase();
    const isMothersDayItem = MOTHERS_DAY_ITEM_KEYS.includes(nameKey);
    const rawActive = typeof item.active === 'undefined' && ['false', 'no', 'inactive', '0'].includes(compactSection)
        ? false
        : item.active;
    const section = ['false', 'no', 'inactive', '0'].includes(compactSection)
        ? 'regular'
        : compactSection.includes('mother') || isMothersDayItem
        ? 'mothers-day'
        : rawSection;

    return {
        name: String(item.name || '').trim(),
        description: String(item.description || '').trim(),
        price: Number(item.price || 0),
        section,
        active: normalizeActiveValue(rawActive)
    };
}

function normalizeActiveValue(value) {
    if (value === '' || value === null || typeof value === 'undefined') return true;
    if (typeof value === 'boolean') return value;
    return String(value).trim().toLowerCase() === 'true';
}

function buildMenuItem(item) {
    const div = document.createElement('div');
    div.classList.add('menu-item');
    const itemKey = slugifyItemName(item.name);
    div.innerHTML = `
        <div class="menu-item-info">
            <label class="menu-item-title">${item.name.toLowerCase()} ($${item.price})</label>
            ${item.description ? `<p class="menu-item-description">${item.description}</p>` : ''}
        </div>
        <input type="number" class="menu-qty" value="0" min="0" data-price="${item.price}" data-name="${itemKey}" data-label="${item.name.toLowerCase()}" data-section="${item.section}">
    `;
    return div;
}

function renderMenu(menu) {
    const normalizedMenu = menu.map(normalizeMenuItem).filter(item => item.name && item.active);
    const mothersDayActive = isMothersDayActive();
    const regularMenu = normalizedMenu.filter(item => item.section === 'regular');
    const mothersDayMenu = mothersDayActive
        ? normalizedMenu.filter(item => item.section === 'mothers-day')
        : [];

    menuContainer.innerHTML = '';
    if (mothersDayContainer) mothersDayContainer.innerHTML = '';

    regularMenu.forEach(item => {
        menuContainer.appendChild(buildMenuItem(item));
    });

    if (!regularMenu.length) {
        menuContainer.textContent = 'menu is currently unavailable.';
    }

    if (mothersDayContainer) {
        mothersDayMenu.forEach(item => {
            mothersDayContainer.appendChild(buildMenuItem(item));
        });

        if (mothersDayActive && !mothersDayMenu.length) {
            mothersDayContainer.innerHTML = '<p class="menu-item-description">mother\'s day menu is loading.</p>';
        }
    }

    if (mothersDaySection) {
        mothersDaySection.style.display = mothersDayActive ? '' : 'none';
    }

    menuQtys = document.querySelectorAll('.menu-qty');
    menuItemsNames = Array.from(menuQtys).map(q => q.dataset.name);
    menuQtys.forEach(input => {
        input.addEventListener('input', calculateTotal);
    });

    calculateTotal();
}

function getCachedMenu() {
    try {
        const raw = localStorage.getItem(MENU_CACHE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed?.menu || !Array.isArray(parsed.menu)) return null;
        const isFresh = Date.now() - Number(parsed.savedAt || 0) < MENU_CACHE_TTL_MS;
        return isFresh ? parsed.menu : null;
    } catch (err) {
        return null;
    }
}

function setCachedMenu(menu) {
    try {
        localStorage.setItem(MENU_CACHE_KEY, JSON.stringify({
            menu,
            savedAt: Date.now()
        }));
    } catch (err) {
        // Ignore storage failures.
    }
}

async function loadMenu() {
    const cachedMenu = getCachedMenu();
    if (cachedMenu && cachedMenu.length) {
        renderMenu(cachedMenu);
    }

    try {
        const res = await fetch(WEB_APP_URL);
        const menu = await res.json();
        if (!Array.isArray(menu) || !menu.length) {
            throw new Error('Invalid menu response');
        }
        renderMenu(menu);
        setCachedMenu(menu);
    } catch (err) {
        console.error(err);
        if (!cachedMenu) {
            menuContainer.textContent = 'menu could not load.';
            if (mothersDayContainer && isMothersDayActive()) {
                mothersDayContainer.innerHTML = '<p class="menu-item-description">mother\'s day menu could not load.</p>';
            }
        }
    }
}

const phoneInput = document.getElementById('phone');
phoneInput.addEventListener('input', function () {
    this.value = this.value.replace(/\D/g, '').slice(0, 10);
});

if (mothersDayPickupInput) {
    mothersDayPickupInput.addEventListener('change', updateFulfillmentRequirements);
}

breadForm.addEventListener('submit', async e => {
    e.preventDefault();
    const form = e.target;
    if (isSubmitting) return;

    updateFulfillmentRequirements();

    const hasOrderedItems = Array.from(menuQtys).some(q => (parseInt(q.value, 10) || 0) > 0);
    if (!hasOrderedItems) {
        alert('please choose at least one item before submitting.');
        return;
    }

    if (!form.checkValidity()) {
        form.reportValidity();
        return;
    }

    const email = document.getElementById('email');
    const phone = document.getElementById('phone');

    if (!email.checkValidity()) {
        alert(email.title);
        email.focus();
        return;
    }

    if (!phone.checkValidity()) {
        alert(phone.title);
        phone.focus();
        return;
    }

    const regularPickup = regularPickupInput?.value || '';
    const mothersDayPickup = mothersDayPickupInput?.value || '';
    const apartment = isWatermarcSelected() ? (apartmentInput?.value.trim() || '') : '';
    const regularPickupDate = regularPickup ? getNextPickupDate(regularPickup) : '';
    const mothersDayPickupDate = mothersDayPickup ? formatLongDate(MOTHERS_DAY_PICKUP_DATE) : '';
    const pickupParts = [];

    if (regularPickup) {
        pickupParts.push(`regular bread: ${regularPickup}${regularPickupDate ? ` (${regularPickupDate})` : ''}`);
    }

    if (mothersDayPickup) {
        pickupParts.push(`mother's day: ${mothersDayPickup}${mothersDayPickupDate ? ` (${mothersDayPickupDate})` : ''}${apartment ? `, apt ${apartment}` : ''}`);
    }

    const pickupRaw = pickupParts.join(' | ');
    const pickupDate = [regularPickupDate, mothersDayPickupDate].filter(Boolean).join(' | ');

    const data = {
        submissionId: buildSubmissionId(),
        name: document.getElementById('name').value,
        email: email.value,
        phone: phone.value,
        total: totalEl.textContent,
        pickup: pickupRaw,
        pickupDate,
        pickupDisplay: pickupRaw,
        regularPickup,
        regularPickupDate,
        mothersDayPickup,
        mothersDayPickupDate,
        apartment,
        fulfillmentNote: getFulfillmentNote(),
        payment: document.querySelector('input[name="payment"]:checked')?.value,
        allergies: document.getElementById('allergies').value,
        requests: document.getElementById('requests').value,
        newsletter: document.querySelector('input[name="newsletter"]:checked')?.value,
        supperclub: document.querySelector('input[name="supperclub"]:checked')?.value,
        feedback: document.getElementById('feedback').value
    };

    data.items = [];
    menuQtys.forEach((q, i) => {
        const qty = parseInt(q.value, 10) || 0;
        const item = {
            key: menuItemsNames[i],
            name: q.dataset.label || menuItemsNames[i],
            qty,
            price: parseFloat(q.dataset.price || '0') || 0
        };
        data[menuItemsNames[i]] = qty;
        data.items.push(item);
    });

    try {
        setSubmitState(true, 'processing your order. please wait...');
        const res = await fetch(WEB_APP_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify(data)
        });

        const raw = await res.text();
        let result = {};
        try {
            result = JSON.parse(raw);
        } catch (parseError) {
            throw new Error('Invalid server response');
        }
        if (typeof result === 'string') {
            result = JSON.parse(result);
        }

        const isSuccess = String(result.result || result.status || '').toLowerCase() === 'success';
        const orderNumber =
            result.orderNumber ||
            result.ordernumber ||
            result.order_number ||
            result?.data?.orderNumber ||
            result?.data?.ordernumber ||
            result?.data?.order_number ||
            (raw.match(/F-\d{4}-\d+/)?.[0]) ||
            'pending';

        const serverTotal = result.total || result?.data?.total;
        const clientTotalNumber = Number(data.total || 0);
        const serverTotalNumber = Number(serverTotal || 0);
        const confirmedTotal = serverTotalNumber >= clientTotalNumber
            ? serverTotalNumber.toFixed(2)
            : clientTotalNumber.toFixed(2);

        if (isSuccess) {
            const orderedItems = data.items
                .filter(item => item.qty > 0)
                .map(item => `${item.name} x${item.qty}`)
                .join('<br>');

            const paymentHandles = {
                'apple pay': 'applepay@fermaison.us',
                'cash app': '$fermaison',
                venmo: '@fermaison',
                zelle: 'fermaison@gmail.com'
            };

            const handle = paymentHandles[data.payment] || 'please follow the payment instructions';
            const paymentConfig = buildPaymentConfig(data.payment, confirmedTotal, orderNumber);
            const payButtonLabel = paymentConfig.supportsPrefill
                ? `pay in ${data.payment}`
                : 'pay manually';
            const paymentNotice = paymentConfig.supportsPrefill
                ? `opens ${data.payment} with amount and order note prefilled`
                : data.payment === 'apple pay'
                    ? 'opens messages with a prefilled payment text'
                    : `${data.payment} cannot be prefilled from web. use the details below`;
            const mainEl = document.querySelector('main');

            mainEl.innerHTML = `
            <div class="payment-card">
                <h2>thank you</h2>
                <p>
                    <strong>order number:</strong>
                    <span id="orderNumber">${orderNumber}</span>
                    <button class="copy-btn" data-copy="orderNumber">copy</button>
                </p>
                <p><strong>items:</strong><br>${orderedItems || 'none'}</p>
                <p><strong>total:</strong> $${confirmedTotal}</p>
                <p><strong>pickup:</strong> ${data.pickupDisplay || data.pickup}</p>
                <p><strong>schedule:</strong> ${data.fulfillmentNote}</p>
                <hr>
                <p>send <strong>$${confirmedTotal}</strong> via <strong>${data.payment}</strong></p>
                <p>
                    <strong id="paymentHandle">${handle}</strong>
                    <button class="copy-btn" data-copy="paymentHandle">copy</button>
                </p>
                <button type="button" id="payNowBtn" class="pay-now-btn">${payButtonLabel}</button>
                <p class="payment-note">${paymentNotice}</p>
                <p>include your order number in the payment notes.</p>
                <p>your order is confirmed once payment is received.</p>
            </div>
            `;

            document.querySelectorAll('.copy-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const targetId = btn.getAttribute('data-copy');
                    const target = document.getElementById(targetId);

                    if (target) {
                        navigator.clipboard.writeText(target.textContent)
                            .then(() => {
                                btn.textContent = 'copied!';
                                setTimeout(() => { btn.textContent = 'copy'; }, 1000);
                            })
                            .catch(() => alert('copy failed'));
                    }
                });
            });

            const payNowBtn = document.getElementById('payNowBtn');
            if (payNowBtn) {
                payNowBtn.addEventListener('click', () => {
                    if (data.payment === 'apple pay') {
                        const smsLink = buildSmsLink('apple pay', handle, confirmedTotal, orderNumber);
                        window.location.href = smsLink;
                        return;
                    }
                    if (!paymentConfig.deepLink && !paymentConfig.webLink) {
                        alert('Please pay manually using the handle and include your order number in the note.');
                        return;
                    }
                    launchPayment(paymentConfig.deepLink, paymentConfig.webLink);
                });
            }
        } else {
            setSubmitState(false, '');
            alert('error submitting order: ' + (result.message || raw));
        }
    } catch (err) {
        setSubmitState(false, '');
        alert('error submitting order: ' + err.message);
    }
});

document.addEventListener('DOMContentLoaded', () => {
    if (!isMothersDayActive() && mothersDaySection) {
        mothersDaySection.style.display = 'none';
    }

    loadMenu();
});
