// tabNavigation.js - Handles tab switching and active state
export function setupTabNavigation() {
    // Direct listeners for existing tabs
    document.querySelectorAll('.tab').forEach(tab => {
        if (!tab.__tabClickBound) {
            tab.addEventListener('click', () => {
                const tabId = tab.getAttribute('data-tab');
                switchTab(tabId);
            });
            tab.__tabClickBound = true;
        }
    });

    // Event delegation on the container to catch any dynamically added tabs
    const container = document.querySelector('.tabs');
    if (container && !container.__tabsDelegationBound) {
        container.addEventListener('click', (e) => {
            const clicked = e.target.closest('.tab');
            if (!clicked || !container.contains(clicked)) return;
            e.preventDefault();
            const tabId = clicked.getAttribute('data-tab');
            switchTab(tabId);
        });
        container.__tabsDelegationBound = true;
    }
}

export function switchTab(tabId) {
    document.querySelectorAll('.tab').forEach(tab => {
        tab.classList.toggle('active', tab.getAttribute('data-tab') === tabId);
    });
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.toggle('active', content.id === tabId);
    });
    window.currentTab = tabId;
    // Persist active tab in global state and preferences if available
    try {
        if (window.state) {
            window.state.activeTab = tabId;
        }
        if (typeof window.saveUIPreferences === 'function') {
            window.saveUIPreferences();
        }
    } catch (e) { /* non-fatal */ }
    
    // Special handling for bills tab to ensure table is rendered
    if (tabId === 'bills') {
        console.log('Switched to bills tab - rendering bills list');
        // Check if renderBillsList function exists in the global scope
        if (typeof window.renderBillsList === 'function') {
            window.renderBillsList();
            // Ensure sticky headers are properly positioned after rendering
            if (typeof window.updateStickyOffsets === 'function') {
                window.updateStickyOffsets();
                // Run it again after a brief delay to ensure everything is rendered
                setTimeout(window.updateStickyOffsets, 100);
            }
        }
    }
    
    // Fire a global event so other parts of the app can listen
    try {
        window.dispatchEvent(new CustomEvent('tabchange', { detail: tabId }));
    } catch (e) {/* ignore if not supported */}
    // Custom render logic for each tab can be called here
    if (window.onTabSwitch) window.onTabSwitch(tabId);
}

// Auto-setup if this module loads after DOM is ready
if (typeof document !== 'undefined') {
    if (document.readyState !== 'loading') {
        try { setupTabNavigation(); } catch {}
    } else {
        document.addEventListener('DOMContentLoaded', () => {
            try { setupTabNavigation(); } catch {}
        });
    }
}

// Expose to global window for non-module consumers / debugging
try {
    window.switchTab = switchTab;
    window.setupTabNavigation = setupTabNavigation;
} catch {}
