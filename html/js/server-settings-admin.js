const SITE_SETTINGS_API = '/api/admin/site-settings';

const CORE_SETTINGS_META = {
    server_display_name: {
        label: 'Ten hien thi server',
        description: 'Ten hien thi cong khai tren website.',
        visibility: 'public',
        type: 'text',
        category: 'minecraft'
    },
    minecraft_ip: {
        label: 'IP Minecraft',
        description: 'Dia chi vao Minecraft Bedrock.',
        visibility: 'public',
        type: 'text',
        category: 'minecraft'
    },
    minecraft_port: {
        label: 'Port Minecraft',
        description: 'Cong vao Minecraft Bedrock.',
        visibility: 'public',
        type: 'number',
        category: 'minecraft'
    },
    hosting_panel_url: {
        label: 'Panel hosting',
        description: 'Link panel hosting dang duoc su dung.',
        visibility: 'private',
        type: 'url',
        category: 'hosting'
    },
    hosting_api_url: {
        label: 'API hosting',
        description: 'Endpoint API hosting neu can goi tu server.',
        visibility: 'private',
        type: 'url',
        category: 'hosting'
    },
    hosting_server_id: {
        label: 'Server ID hosting',
        description: 'Ma server dang duoc quan ly tren hosting.',
        visibility: 'private',
        type: 'text',
        category: 'hosting'
    }
};

const coreForm = document.getElementById('coreSettingsForm');
const coreStatus = document.getElementById('coreStatus');
const refreshCoreBtn = document.getElementById('refreshCoreBtn');
const settingsList = document.getElementById('settingsList');
const refreshListBtn = document.getElementById('refreshListBtn');
const settingForm = document.getElementById('settingForm');
const formStatus = document.getElementById('formStatus');
const formModeBadge = document.getElementById('formModeBadge');
const settingSubmitBtn = document.getElementById('settingSubmitBtn');
const resetFormBtn = document.getElementById('resetFormBtn');
const editingKeyInput = document.getElementById('editingKeyInput');
const settingKeyInput = document.getElementById('settingKeyInput');
const settingLabelInput = document.getElementById('settingLabelInput');
const settingValueInput = document.getElementById('settingValueInput');
const settingVisibilityInput = document.getElementById('settingVisibilityInput');
const settingTypeInput = document.getElementById('settingTypeInput');
const settingCategoryInput = document.getElementById('settingCategoryInput');
const settingDescriptionInput = document.getElementById('settingDescriptionInput');

const countdownForm = document.getElementById('countdownForm');
const countdownDateInput = document.getElementById('countdownDate');
const countdownTimeInput = document.getElementById('countdownTime');
const countdownDescInput = document.getElementById('countdownDesc');
const countdownStatus = document.getElementById('countdownStatus');

const publicCountEl = document.getElementById('publicCount');
const privateCountEl = document.getElementById('privateCount');
const systemCountEl = document.getElementById('systemCount');
const customCountEl = document.getElementById('customCount');

const displayNameInput = document.getElementById('displayNameInput');
const minecraftIpInput = document.getElementById('minecraftIpInput');
const minecraftPortInput = document.getElementById('minecraftPortInput');
const hostingPanelUrlInput = document.getElementById('hostingPanelUrlInput');
const hostingApiUrlInput = document.getElementById('hostingApiUrlInput');
const hostingServerIdInput = document.getElementById('hostingServerIdInput');

let settingsState = [];

function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('overlay');
    if (!sidebar || !overlay) return;

    if (sidebar.classList.contains('-left-[260px]')) {
        sidebar.classList.remove('-left-[260px]');
        sidebar.classList.add('left-0');
        overlay.classList.remove('hidden');
    } else {
        sidebar.classList.add('-left-[260px]');
        sidebar.classList.remove('left-0');
        overlay.classList.add('hidden');
    }
}

function escapeHtml(value) {
    const div = document.createElement('div');
    div.textContent = String(value ?? '');
    return div.innerHTML;
}

function setStatus(target, text, ok = true) {
    if (!target) return;
    target.textContent = text || '';
    // Thêm hiệu ứng hiển thị rõ ràng hơn
    target.style.opacity = text ? '1' : '0';
    target.className = `status${text ? ` ${ok ? 'ok' : 'err'}` : ''}`;
    
    // Nếu là thông báo thành công/lỗi thì tự biến mất sau 5s, nếu là "Đang lưu" thì giữ nguyên
    if (text && text !== 'Đang lưu...') {
        setTimeout(() => {
            if (target.textContent === text) {
                target.style.opacity = '0';
                setTimeout(() => { target.textContent = ''; }, 300);
            }
        }, 5000);
    }
}

function formatDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Không rõ';
    return date.toLocaleString('vi-VN');
}

function getSetting(key) {
    return settingsState.find((item) => item.key === key) || null;
}

function updateSummary(items) {
    const publicCount = items.filter((item) => item.visibility === 'public').length;
    const privateCount = items.filter((item) => item.visibility === 'private').length;
    const systemCount = items.filter((item) => item.system).length;
    const customCount = items.filter((item) => !item.system).length;

    publicCountEl.textContent = String(publicCount);
    privateCountEl.textContent = String(privateCount);
    systemCountEl.textContent = String(systemCount);
    customCountEl.textContent = String(customCount);
}

function populateCoreForm() {
    displayNameInput.value = getSetting('server_display_name')?.value || '';
    minecraftIpInput.value = getSetting('minecraft_ip')?.value || '';
    minecraftPortInput.value = getSetting('minecraft_port')?.value || '';
    hostingPanelUrlInput.value = getSetting('hosting_panel_url')?.value || '';
    hostingApiUrlInput.value = getSetting('hosting_api_url')?.value || '';
    hostingServerIdInput.value = getSetting('hosting_server_id')?.value || '';
}

function resetSettingForm(preserveStatus = false) {
    editingKeyInput.value = '';
    settingForm.reset();
    settingVisibilityInput.value = 'public';
    settingTypeInput.value = 'text';
    formModeBadge.innerHTML = '<i class="fa-solid fa-pen"></i> Add mode';
    settingSubmitBtn.innerHTML = '<i class="fa-solid fa-plus"></i> Lưu thông số';
    settingKeyInput.readOnly = false;
    if (!preserveStatus) {
        setStatus(formStatus, '');
    }
}

function populateSettingForm(item) {
    if (!item) return;
    editingKeyInput.value = item.key;
    settingKeyInput.value = item.key;
    settingLabelInput.value = item.label || '';
    settingValueInput.value = item.value || '';
    settingVisibilityInput.value = item.visibility || 'public';
    settingTypeInput.value = item.type || 'text';
    settingCategoryInput.value = item.category || '';
    settingDescriptionInput.value = item.description || '';
    formModeBadge.innerHTML = `<i class="fa-solid fa-pen-to-square"></i> Edit: ${escapeHtml(item.key)}`;
    settingSubmitBtn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Cập nhật thông số';
    settingKeyInput.readOnly = true;
    settingForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderSettingsList(items) {
    if (!items.length) {
        settingsList.innerHTML = '<div class="empty-state">Chưa có thông số nào.</div>';
        return;
    }

    settingsList.innerHTML = items.map((item) => {
        const value = item.value ? escapeHtml(item.value) : '<span style="opacity:.65">(trống)</span>';
        const description = item.description
            ? `<p class="text-sm text-slate-500 mt-2">${escapeHtml(item.description)}</p>`
            : '';
        const resetLabel = item.system ? 'Khôi phục' : 'Xóa';
        const resetIcon = item.system ? 'fa-rotate-left' : 'fa-trash';

        return `
            <article class="setting-card" data-key="${escapeHtml(item.key)}">
                <div class="setting-head">
                    <div class="setting-title">
                        <h3 class="text-xl font-black">${escapeHtml(item.label || item.key)}</h3>
                        <span class="setting-key">${escapeHtml(item.key)}</span>
                        ${description}
                    </div>
                    <div class="badges">
                        <span class="badge ${item.visibility === 'private' ? 'private' : 'public'}">
                            <i class="fa-solid ${item.visibility === 'private' ? 'fa-lock' : 'fa-globe'}"></i>
                            ${item.visibility}
                        </span>
                        <span class="badge ${item.system ? 'system' : 'custom'}">
                            <i class="fa-solid ${item.system ? 'fa-shield' : 'fa-sparkles'}"></i>
                            ${item.system ? 'system' : 'custom'}
                        </span>
                        <span class="badge system">
                            <i class="fa-solid fa-tag"></i>
                            ${escapeHtml(item.type || 'text')}
                        </span>
                    </div>
                </div>
                <div class="setting-value">${value}</div>
                <div class="flex flex-wrap items-center justify-between gap-3">
                    <div class="text-sm text-slate-500">
                        <span class="font-semibold text-slate-600">Nhóm:</span> ${escapeHtml(item.category || 'general')}
                        <span class="mx-2">•</span>
                        <span class="font-semibold text-slate-600">Cập nhật:</span> ${escapeHtml(formatDate(item.updatedAt))}
                    </div>
                    <div class="actions">
                        ${item.isVirtual ? `
                            <button class="btn btn-secondary" type="button" onclick="window.scrollTo({top:0, behavior:'smooth'})">
                                <i class="fa-solid fa-arrow-up"></i> Sửa ở trên
                            </button>
                        ` : `
                            <button class="btn btn-secondary" type="button" data-action="edit" data-key="${escapeHtml(item.key)}">
                                <i class="fa-solid fa-pen"></i> Sửa
                            </button>
                            <button class="btn btn-danger" type="button" data-action="delete" data-key="${escapeHtml(item.key)}">
                                <i class="fa-solid ${resetIcon}"></i> ${resetLabel}
                            </button>
                        `}
                    </div>
                </div>
            </article>
        `;
    }).join('');
}

async function fetchSettings() {
    const response = await fetch(SITE_SETTINGS_API, {
        credentials: 'same-origin'
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok || !payload.success) {
        throw new Error(payload.error || 'Không thể tải danh sách thông số.');
    }

    return Array.isArray(payload.items) ? payload.items : [];
}

async function loadSettings(statusTarget = null, successMessage = '') {
    if (statusTarget) setStatus(statusTarget, 'Đang tải dữ liệu...', true);

    try {
        const [mainSettings, countdownData] = await Promise.all([
            fetchSettings(),
            fetch('/api/config/countdown-settings').then(r => r.json()).catch(() => null)
        ]);

        let combinedItems = [...mainSettings];
        if (countdownData) {
            combinedItems.push({
                key: 'countdown_event',
                value: `${countdownData.eventDate} ${countdownData.eventTime} (${countdownData.eventDescription})`,
                category: 'system',
                description: 'Thời gian đếm ngược (Cấu hình ở phần trên)',
                isVirtual: true
            });
        }

        settingsState = combinedItems;
        updateSummary(settingsState);
        populateCoreForm();
        renderSettingsList(settingsState);
        if (statusTarget) setStatus(statusTarget, successMessage, true);
    } catch (error) {
        updateSummary([]);
        renderSettingsList([]);
        if (statusTarget) setStatus(statusTarget, error.message, false);
    }
}

async function loadCountdownSettings() {
    try {
        const response = await fetch('/api/config/countdown-settings');
        const data = await response.json();
        if (data) {
            countdownDateInput.value = data.eventDate || '';
            countdownTimeInput.value = data.eventTime || '';
            countdownDescInput.value = data.eventDescription || '';
        }
    } catch (error) {
        console.error('Failed to load countdown settings:', error);
    }
}

async function saveSettings(items, statusTarget, successMessage) {
    const response = await fetch(SITE_SETTINGS_API, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json'
        },
        credentials: 'same-origin',
        body: JSON.stringify({ items })
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok || !payload.success) {
        throw new Error(payload.error || 'Không thể lưu thông số.');
    }

    await loadSettings(statusTarget, successMessage);
    return payload;
}

function buildCorePayload() {
    return [
        {
            key: 'server_display_name',
            value: displayNameInput.value.trim(),
            ...CORE_SETTINGS_META.server_display_name
        },
        {
            key: 'minecraft_ip',
            value: minecraftIpInput.value.trim(),
            ...CORE_SETTINGS_META.minecraft_ip
        },
        {
            key: 'minecraft_port',
            value: minecraftPortInput.value.trim(),
            ...CORE_SETTINGS_META.minecraft_port
        },
        {
            key: 'hosting_panel_url',
            value: hostingPanelUrlInput.value.trim(),
            ...CORE_SETTINGS_META.hosting_panel_url
        },
        {
            key: 'hosting_api_url',
            value: hostingApiUrlInput.value.trim(),
            ...CORE_SETTINGS_META.hosting_api_url
        },
        {
            key: 'hosting_server_id',
            value: hostingServerIdInput.value.trim(),
            ...CORE_SETTINGS_META.hosting_server_id
        }
    ];
}

async function handleDelete(key) {
    const item = getSetting(key);
    if (!item) return;

    const actionText = item.system
        ? `Khôi phục "${item.label || item.key}" về giá trị mặc định?`
        : `Xóa hẳn thông số "${item.label || item.key}"?`;

    if (!window.confirm(actionText)) return;

    try {
        const response = await fetch(`${SITE_SETTINGS_API}/${encodeURIComponent(key)}`, {
            method: 'DELETE',
            credentials: 'same-origin'
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload.success) {
            throw new Error(payload.error || 'Không thể xóa thông số.');
        }

        await loadSettings(formStatus, item.system ? 'Đã khôi phục về mặc định.' : 'Đã xóa thông số.');
        setStatus(coreStatus, item.system ? 'Đã khôi phục một key hệ thống về mặc định.' : '', true);
        if (editingKeyInput.value === key) {
            resetSettingForm(true);
        }
    } catch (error) {
        setStatus(formStatus, error.message, false);
    }
}

coreForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    setStatus(coreStatus, 'Đang lưu thông số cốt lõi...', true);

    try {
        await saveSettings(buildCorePayload(), coreStatus, 'Đã lưu thông số cốt lõi.');
    } catch (error) {
        setStatus(coreStatus, error.message, false);
    }
});

refreshCoreBtn.addEventListener('click', () => {
    loadSettings(coreStatus, 'Đã tải lại cấu hình từ server.');
});

settingForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    setStatus(formStatus, 'Đang lưu thông số...', true);

    const key = (editingKeyInput.value || settingKeyInput.value).trim();
    const payload = [{
        key,
        label: settingLabelInput.value.trim(),
        value: settingValueInput.value.trim(),
        visibility: settingVisibilityInput.value,
        type: settingTypeInput.value,
        category: settingCategoryInput.value.trim(),
        description: settingDescriptionInput.value.trim()
    }];

    try {
        const successMessage = editingKeyInput.value ? 'Đã cập nhật thông số.' : 'Đã thêm thông số mới.';
        await saveSettings(payload, formStatus, successMessage);
        resetSettingForm(true);
        setStatus(formStatus, successMessage, true);
    } catch (error) {
        setStatus(formStatus, error.message, false);
    }
});

resetFormBtn.addEventListener('click', () => {
    resetSettingForm();
});

refreshListBtn.addEventListener('click', () => {
    loadSettings(formStatus, 'Đã làm mới danh sách thông số.');
});

settingsList.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;

    const key = button.dataset.key;
    if (!key) return;

    if (button.dataset.action === 'edit') {
        const item = getSetting(key);
        populateSettingForm(item);
        setStatus(formStatus, item?.system
            ? 'Bạn đang sửa một key hệ thống.'
            : 'Bạn đang sửa một key custom.', true);
        return;
    }

    if (button.dataset.action === 'delete') {
        handleDelete(key);
    }
});

document.addEventListener('DOMContentLoaded', () => {
    resetSettingForm();
    loadSettings();
    loadCountdownSettings();

    // Đảm bảo listener được gắn sau khi DOM đã sẵn sàng
    if (countdownForm) {
        countdownForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            setStatus(countdownStatus, 'Đang lưu...', true);

            try {
                const response = await fetch('/api/admin/countdown-settings', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        eventDate: countdownDateInput.value.trim(),
                        eventTime: countdownTimeInput.value.trim(),
                        eventDescription: countdownDescInput.value.trim()
                    })
                });
                
                const result = await response.json();
                if (result.success) {
                    setStatus(countdownStatus, 'Đã lưu thành công!', true);
                    loadSettings();
                } else {
                    throw new Error(result.error || 'Lỗi không xác định');
                }
            } catch (error) {
                console.error('Countdown Save Error:', error);
                setStatus(countdownStatus, error.message, false);
            }
        });
    }
});
