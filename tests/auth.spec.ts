import { test, expect } from "@playwright/test";

test("refresh restores a persisted session without rendering login, including token refresh", async ({page}) => {
  let release!:()=>void;
  const gate=new Promise<void>(resolve=>release=resolve);
  let refreshes=0;
  await page.addInitScript(()=>{
    (window as any).loginFlashed=false;
    new MutationObserver(records=>{
      if(document.querySelector('.login') || records.some(record=>[...record.addedNodes].some(node=>node instanceof Element && (node.matches('.login') || node.querySelector('.login'))))) (window as any).loginFlashed=true;
    }).observe(document,{subtree:true,childList:true});
    if(!sessionStorage.getItem('auth-fixture-seeded')) { sessionStorage.setItem('auth-fixture-seeded','yes'); localStorage.setItem('sb-test-auth-token',JSON.stringify({access_token:'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.fake',refresh_token:'test-refresh',expires_at:Math.floor(Date.now()/1000)-3600,token_type:'bearer',user:{id:'test',email:'readyreadymotors9999@gmail.com',aud:'authenticated',role:'authenticated'}})); }
  });
  await page.route('https://test.supabase.co/**',async route=>{
    if(route.request().url().includes('/auth/v1/token')){
      refreshes++;await gate;
      return route.fulfill({json:{access_token:'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.fake',refresh_token:'new-refresh',expires_in:3600,token_type:'bearer',user:{id:'test',email:'readyreadymotors9999@gmail.com',aud:'authenticated',role:'authenticated'}}});
    }
    if(route.request().url().includes('/rest/v1/documents'))return route.fulfill({json:[]});
    if(route.request().url().includes('/auth/v1/logout'))return route.fulfill({status:204,body:''});
    return route.fulfill({json:{recipients:[]}});
  });
  await page.goto('/#/settings');
  await expect(page.getByText('Restoring your session…',{exact:true})).toBeVisible();
  await expect.poll(()=>refreshes).toBe(1);
  expect(await page.evaluate(()=>(window as any).loginFlashed)).toBe(false);
  await expect(page.locator('.login')).toHaveCount(0);
  release();
  await expect(page.getByRole('heading',{name:'My Account',exact:true})).toBeVisible();
  expect(await page.evaluate(()=>(window as any).loginFlashed)).toBe(false);
  await page.reload();
  await expect(page.getByRole('heading',{name:'My Account',exact:true})).toBeVisible();
  expect(await page.evaluate(()=>(window as any).loginFlashed)).toBe(false);
  await page.getByRole('button',{name:'My Account',exact:true}).click();
  await page.getByRole('button',{name:'Sign out',exact:true}).click();
  await expect(page.locator('.login')).toBeVisible();
  await page.reload();
  await expect(page.locator('.login')).toBeVisible();
});

test("a signed-out visitor sees login once session restoration completes",async({page})=>{
  await page.goto('/');
  await expect(page.locator('.login')).toBeVisible();
  await expect(page.getByText('Restoring your session…',{exact:true})).toHaveCount(0);
});
