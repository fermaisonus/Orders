const WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbxAhByd30dfj83zNLLl-KBvHNuYn4ksaVCzWMBHsf6gTnV5Aaf86yP6IJyhUg4YSm3v/exec';
const menuContainer = document.getElementById('menuContainer');
const totalEl = document.getElementById('total');
let menuQtys = [];
let menuItemsNames = [];

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

async function loadMenu() {
    try {
        const res = await fetch(WEB_APP_URL);
        const menu = await res.json();

        menuContainer.innerHTML = '';
        menu.forEach(item => {
            const div = document.createElement('div');
            div.classList.add('menu-item');
            div.innerHTML = `
                <label>${item.name.toLowerCase()} ($${item.price})</label>
                <input type="number" class="menu-qty" value="0" min="0" data-price="${item.price}">
            `;
            menuContainer.appendChild(div);
        });

        menuQtys = document.querySelectorAll('.menu-qty');
        menuItemsNames = menu.map(item => item.name.toLowerCase());
        menuQtys.forEach(input => {
            input.addEventListener('input', calculateTotal);
        });
        calculateTotal();
    } catch (err) {
        console.error(err);
        menuContainer.textContent = 'Menu could not load.';
    }
}

const phoneInput = document.getElementById('phone');
phoneInput.addEventListener('input', function () {
    this.value = this.value.replace(/\D/g, '').slice(0, 10);
});

document.getElementById('breadForm').addEventListener('submit', async e => {
    e.preventDefault();
    const form = e.target;

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
        name: document.getElementById('name').value,
        email: email.value,
        phone: phone.value,
        total: totalEl.textContent,
        pickup: pickupRaw,
        pickupDate: pickupDate,
        pickupDisplay: `${pickupRaw} (${pickupDate})`,
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
                <hr>
                <p>send <strong>$${confirmedTotal}</strong> via <strong>${data.payment}</strong></p>
                <p>
                    <strong id="paymentHandle">${handle}</strong>
                    <button class="copy-btn" data-copy="paymentHandle">copy</button>
                </p>
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
        } else {
            alert('error submitting order: ' + (result.message || raw));
        }
    } catch (err) {
        alert('error submitting order: ' + err.message);
    }
});

document.addEventListener('DOMContentLoaded', loadMenu);
