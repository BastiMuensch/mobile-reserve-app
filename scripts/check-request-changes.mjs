import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const browser = await chromium.launch({ headless:true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? {executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE} : {}) });
await mkdir('output/request-changes',{recursive:true});
try {
  for (const width of [1440,390,320]) {
    const context=await browser.newContext({viewport:{width,height:950},locale:'de-DE',timezoneId:'Europe/Berlin'});
    const page=await context.newPage();
    await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto('http://127.0.0.1:3145');
    await page.getByRole('button',{name:'Stunden / Vermerk bearbeiten',exact:true}).click();
    const dialog=page.getByRole('dialog');
    const state=JSON.parse(await page.getByTestId('fixture-state').textContent());
    await dialog.getByLabel('Einsatztag',{exact:true}).fill(state.days[0]);
    for(const hour of [1,2,3,4,5,6,7,8,9,10]) {
      const button=dialog.getByRole('button',{name:`${hour}. Stunde`,exact:true});
      if ((await button.getAttribute('aria-pressed')==='true') !== (hour<=2)) await button.click();
    }
    assert.ok(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1));
    await page.screenshot({path:`output/request-changes/school-${width}.png`});
    await dialog.getByRole('button',{name:'Stundenänderung zur Prüfung senden',exact:true}).click();
    await dialog.waitFor({state:'hidden'});
    await page.getByRole('button',{name:'Änderungen prüfen (1)',exact:true}).click();
    await dialog.getByText('Beim Schulamt in Prüfung',{exact:true}).waitFor();
    assert.ok(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1));
    await page.screenshot({path:`output/request-changes/office-${width}.png`});
    await dialog.getByRole('button',{name:'Freigeben',exact:true}).click();
    await dialog.waitFor({state:'hidden'});
    await page.getByRole('button',{name:'Stunden / Vermerk bearbeiten',exact:true}).click();
    await dialog.getByText('Freigegeben',{exact:true}).waitFor();
    await dialog.getByLabel('Organisatorischer Vermerk',{exact:true}).fill('Treffpunkt Sekretariat');
    await dialog.getByRole('button',{name:'Vermerk speichern und informieren',exact:true}).click();
    await dialog.waitFor({state:'hidden'});
    assert.deepEqual(errors,[]);
    await context.close();
    console.log(`Änderungsablauf bei ${width}px erfolgreich`);
  }
} finally { await browser.close(); }
