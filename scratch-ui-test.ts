import { chromium } from "playwright";

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(String(err)));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });

  await page.goto("http://localhost:4322/");
  await page.waitForSelector("#rows tr");

  const rowCountBefore = await page.locator("#rows tr").count();
  console.log("rows rendered:", rowCountBefore);
  console.log("summary text:", await page.locator("#summary").innerText());

  await page.screenshot({ path: "scratch-ui-list.png", fullPage: true });

  // Open add dialog
  await page.click("#open-add");
  await page.waitForSelector("#pincode-dialog[open]");
  await page.screenshot({ path: "scratch-ui-add-dialog.png" });

  // Fill and toggle "use specific address"
  await page.fill("#f-pincode", "999999");
  await page.fill("#f-city", "UI Test City");
  await page.click("#advanced-details summary");
  await page.fill("#f-searchText", "UI Test Address 999999");
  await page.check("#f-relianceDigital");
  await page.screenshot({ path: "scratch-ui-add-filled.png" });

  await page.click("#dialog-save");
  await page.waitForSelector("#toast.show");
  console.log("toast after add:", await page.locator("#toast").innerText());

  await page.waitForTimeout(400);
  const rowCountAfter = await page.locator("#rows tr").count();
  console.log("rows after add:", rowCountAfter);

  // Search filter test
  await page.fill("#search-box", "UI Test");
  await page.waitForTimeout(200);
  const filteredCount = await page.locator("#rows tr").count();
  console.log("rows after searching 'UI Test':", filteredCount);
  await page.screenshot({ path: "scratch-ui-search.png" });

  // Edit the new row
  await page.click(".edit-btn");
  await page.waitForSelector("#pincode-dialog[open]");
  console.log("dialog title on edit:", await page.locator("#dialog-title").innerText());
  console.log("advanced details open on edit (has searchText):", await page.locator("#advanced-details").getAttribute("open"));
  await page.screenshot({ path: "scratch-ui-edit-dialog.png" });
  await page.fill("#f-city", "UI Test City Edited");
  await page.click("#dialog-save");
  await page.waitForSelector("#toast.show");
  console.log("toast after edit:", await page.locator("#toast").innerText());
  await page.waitForTimeout(300);

  // Delete it (cleanup) - accept the confirm dialog
  page.once("dialog", (d) => d.accept());
  await page.click(".delete-btn");
  await page.waitForTimeout(400);
  const rowCountFinal = await page.locator("#rows tr").count();
  console.log("rows after delete (search still active):", rowCountFinal);

  await page.fill("#search-box", "");
  await page.waitForTimeout(200);
  console.log("total rows back to baseline:", await page.locator("#rows tr").count());

  console.log("console/page errors captured:", errors.length ? errors : "none");

  await browser.close();
}

main().catch((err) => {
  console.error("TEST FAILED", err);
  process.exit(1);
});
