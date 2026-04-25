const WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbxAhByd30dfj83zNLLl-KBvHNuYn4ksaVCzWMBHsf6gTnV5Aaf86yP6IJyhUg4YSm3v/exec';
const MENU_CACHE_KEY = 'fermaison_menu_cache_v1';
const MENU_CACHE_TTL_MS = 10 * 60 * 1000;

const MOTHERS_DAY_END = new Date('2026-05-07T23:59:59');
const SHOW_MOTHERS_DAY = new Date() <= MOTHERS_DAY_END;

const menuContainer = document.getElementById('menuContainer');
const totalEl = document.getElementById('total');
const breadForm = document.getElementById('breadForm');
const submitBtn = breadForm.querySelector('button[type="submit"]');
const submitStatusEl = document.getElementById('submitStatus');

let menuQtys = [];
let menuItemsNames = [];
let isSubmitting = false;

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

    return new Intl.DateTimeFormat('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        year: 'numeric'
    }).format(pickupDate);
}

function getFulfillmentNote(now = new Date()) {
    const day = now.getDay(); // 0=sun ... 6=sat
    const isNextWeekWindow = day === 0 || day >= 4;
    return isNextWeekWindow
        ? "this order is scheduled for next week's pickup window."
        : "this order is scheduled for this week's pickup window.";
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
        'venmo': {
            deepLink: `venmo://paycharge?txn=pay&recipients=fermaison&amount=${amount}&note=${encodedNote}`,
            webLink: `https://venmo.com/fermaison?txn=pay&amount=${amount}&note=${encodedNote}`,
            supportsPrefill: true
        },
        'apple pay': {
            deepLink: '',
            webLink: '',
            supportsPrefill: false
        },
        'zelle': {
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

function renderMenu(menu) {
    menuContainer.innerHTML = '';

    const mothersDayContainer = document.getElementById('mothersDayItems');
    if (mothersDayContainer) {
        mothersDayContainer.innerHTML = '';
    }

    const regularMenu = menu.filter(item => item.section === 'regular' && item.active);
    const mothersDayMenu = menu.filter(item => item.section === 'mothers-day' && item.active);

    regularMenu.forEach(item => {
        const div = document.createElement('div');
        div.classList.add('menu-item');
        div.innerHTML = `
            <div class="menu-item-info">
                <label class="menu-item-title">${item.name.toLowerCase()} ($${item.price})</label>
                ${item.description ? `<p class="menu-item-description">${item.description}</p>` : ''}
            </div>
            <input type="number" class="menu-qty" value="0" min="0" data-price="${item.price}" data-name="${item.name.toLowerCase()}">
        `;
        menuContainer.appendChild(div);
    });

    if (mothersDayContainer) {
        mothersDayMenu.forEach(item => {
            const div = document.createElement('div');
            div.classList.add('menu-item');
            div.innerHTML = `
                <div class="menu-item-info">
                    <label class="menu-item-title">${item.name.toLowerCase()} ($${item.price})</label>
                    ${item.description ? `<p class="menu-item-description">${item.description}</p>` : ''}
                </div>
                <input type="number" class="menu-qty" value="0" min="0" data-price="${item.price}" data-name="${item.name.toLowerCase()}">
            `;
            mothersDayContainer.appendChild(div);
        });
    }

    const mothersDaySection = document.getElementById('mothersDaySection');
    if (mothersDaySection) {
        mothersDaySection.style.display = mothersDayMenu.length ? '' : 'none';
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

function renderMothersDayMenu() {
    const container = document.getElementById('mothersDayContainer');
    if (!container) return;

    container.innerHTML = `
        <div class="card">
            <h2>mother's day</h2>

            <div class="md-frame">
                
                <!-- LEFT SVG -->
                <div class="md-art left">
                    ${heartSVG()}
                </div>

                <!-- MENU -->
                <div class="md-menu">
                    <p><strong>“maman”</strong><br>
                    personal size focaccia des rois & a bespoke arrangement that’ll transport her to the french countryside.</p>

                    <p><strong>“mom”</strong><br>
                    personal size strawberry cheesecake focaccia & a whimsy arrangement that’ll feel too aesthetic not to post (;</p>

                    <p><strong>“mamã”</strong><br>
                    personal size focaccia with garlic confit and olives + a gorgeous arrangement that’ll end up front and center at the dinner table</p>
                </div>

                <!-- RIGHT SVG -->
                <div class="md-art right">
                    ${roseSVG()}
                </div>

            </div>
        </div>
    `;
}

function heartSVG() {
    return `
    <svg viewBox="0 0 200 200" width="120">
        <path d="M100 180 L20 90 A40 40 0 1 1 100 40 A40 40 0 1 1 180 90 Z"
              fill="none" stroke="black" stroke-width="2"/>
        <path d="M50 100 H150" stroke="black" stroke-width="2"/>
        <text x="100" y="95" text-anchor="middle" font-size="16">MOM</text>
    </svg>`;
}

function roseSVG() {
    return `
    <svg viewBox="0 0 200 200" width="120">
        <circle cx="100" cy="80" r="30" fill="none" stroke="black" stroke-width="2"/>
        <path d="M100 110 L100 170" stroke="black" stroke-width="2"/>
        <path d="M100 130 C80 120, 80 140, 100 140" fill="none" stroke="black" stroke-width="2"/>
        <path d="M100 150 C120 140, 120 160, 100 160" fill="none" stroke="black" stroke-width="2"/>
    </svg>`;
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
            menuContainer.textContent = 'Menu could not load.';
        }
    }
}

function isMothersDayActive() {
    return SHOW_MOTHERS_DAY && new Date() <= MOTHERS_DAY_END;
}

const phoneInput = document.getElementById('phone');
phoneInput.addEventListener('input', function () {
    this.value = this.value.replace(/\D/g, '').slice(0, 10);
});

breadForm.addEventListener('submit', async e => {
    e.preventDefault();
    const form = e.target;
    if (isSubmitting) return;

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

    const pickupRaw = document.getElementById('pickup').value;
    const pickupDate = getNextPickupDate(pickupRaw);

    const data = {
        submissionId: buildSubmissionId(),
        name: document.getElementById('name').value,
        email: email.value,
        phone: phone.value,
        total: totalEl.textContent,
        pickup: pickupRaw,
        pickupDate: pickupDate,
        pickupDisplay: `${pickupRaw} (${pickupDate})`,
        fulfillmentNote: getFulfillmentNote(),
        payment: document.querySelector('input[name="payment"]:checked')?.value,
        allergies: document.getElementById('allergies').value,
        requests: document.getElementById('requests').value,
        newsletter: document.querySelector('input[name="newsletter"]:checked')?.value,
        supperclub: document.querySelector('input[name="supperclub"]:checked')?.value,
        feedback: document.getElementById('feedback').value
    };

    menuQtys.forEach((q, i) => {
        data[menuItemsNames[i]] = parseInt(q.value, 10) || 0;
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
        try { result = JSON.parse(raw); } catch (parseError) {
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

        const confirmedTotal = result.total || result?.data?.total || data.total;

        if (isSuccess) {
            const orderedItems = menuItemsNames
                .filter(name => data[name] > 0)
                .map(name => `${name} x${data[name]}`)
                .join('<br>');

            const paymentHandles = {
                'apple pay': 'applepay@fermaison.us',
                'cash app': '$fermaison',
                'venmo': '@fermaison',
                'zelle': 'fermaison@gmail.com'
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
                <h2>thank you 💕</h2>
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
                <p class="payment-note">orders placed after wednesday are fulfilled in the following week's pickup window.</p>
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
    const mothersDaySection = document.getElementById('mothersDaySection');

    if (!isMothersDayActive() && mothersDaySection) {
        mothersDaySection.style.display = 'none';
    }

    loadMenu();
});

