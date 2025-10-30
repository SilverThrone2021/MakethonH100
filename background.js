// background.js

// Toggles the side panel when the action icon is clicked
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'open_side_panel') {
        chrome.sidePanel.open({ windowId: sender.tab.windowId });
    }
});
