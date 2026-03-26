const ext = typeof browser !== "undefined" ? browser : chrome;
const scripting = ext.scripting || {
  executeScript: ({ target, files }) =>
    ext.tabs.executeScript(target.tabId, { file: files[0] }),
};

const clickTarget = ext.action || ext.browserAction;
clickTarget.onClicked.addListener(async (tab) => {
  try {
    await scripting.insertCSS({
      target: { tabId: tab.id },
      files: ["spyglass-styles.css"],
    });
    await scripting.executeScript({
      target: { tabId: tab.id },
      files: ["spyglass.js"],
    });
  } catch (error) {
    console.error("Failed to execute script:", error);
  }
});
