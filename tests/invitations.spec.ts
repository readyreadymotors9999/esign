import {test,expect} from '@playwright/test';
import {PDFDocument} from 'pdf-lib';

test('sent documents expose renewal only for unfinished signers and show a fresh share link',async({page})=>{
 const pdf=await PDFDocument.create();pdf.addPage([600,800]);const bytes=Buffer.from(await pdf.save());
 const doc={id:'33333333-3333-4333-8333-333333333333',title:'Invitation test',status:'sent',fields:[],signers:[],original_path:'original.pdf',created_at:new Date().toISOString()};
 const invitations=[{id:'signed',signer_name:'Already Signed',recipient_email:'signed@example.com',status:'completed',expires_at:new Date().toISOString(),delivery:'email'},{id:'pending',signer_name:'Waiting Person',recipient_email:'waiting@example.com',status:'pending',expires_at:new Date(Date.now()-3600000).toISOString(),delivery:'email'},{id:'shared',signer_name:'Share Person',recipient_email:'share@example.com',status:'pending',expires_at:new Date(Date.now()+3600000).toISOString(),delivery:'share'}];
 let sends=0;
 await page.addInitScript(()=>localStorage.setItem('sb-test-auth-token',JSON.stringify({access_token:'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.fake',refresh_token:'test',expires_at:Math.floor(Date.now()/1000)+3600,token_type:'bearer',user:{id:'test',email:'readyreadymotors9999@gmail.com',aud:'authenticated'}})));
 await page.route('**/invitation.pdf',route=>route.fulfill({contentType:'application/pdf',body:bytes}));
 await page.route('https://test.supabase.co/**',route=>{
  if(route.request().url().includes('/rest/v1/documents'))return route.fulfill({json:[doc]});
  const body=route.request().postDataJSON();
  if(body.action==='recipients')return route.fulfill({json:{recipients:[]}});
  if(body.action==='detail')return route.fulfill({json:{document:doc,audit:[],invitations,url:'/invitation.pdf',capabilities:{resendInvitation:true}}});
  if(body.action==='resend_invitation'){
   expect(body.sessionId).not.toBe('signed');sends++;
   const invitation=invitations.find(item=>item.id===body.sessionId)!;
   invitation.expires_at=new Date(Date.now()+72*3600000).toISOString();
   return route.fulfill({json:body.sessionId==='shared'?{link:'https://example.com/#/sign/fresh-share',expires_at:invitation.expires_at}:{sent:true,expires_at:invitation.expires_at}});
  }
  return route.fulfill({status:400,json:{error:'Unexpected action'}});
 });
 await page.goto('/');await page.getByRole('button',{name:/PDF Invitation test/}).click();
 const cards=page.locator('.invitation-card');
 await expect(cards.filter({hasText:'Already Signed'}).getByRole('button')).toHaveCount(0);
 await expect(cards.filter({hasText:'Waiting Person'})).toContainText('Expired');
 page.once('dialog',dialog=>dialog.dismiss());await page.getByRole('button',{name:'Resend invite',exact:true}).click();expect(sends).toBe(0);
 page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Resend invite',exact:true}).click();
 await expect(page.getByText('Invitation resent',{exact:true})).toBeVisible();expect(sends).toBe(1);
 await expect(cards.filter({hasText:'Waiting Person'})).toContainText('Awaiting signature');
 page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Create new 72-hour link',exact:true}).click();
 await expect(page.getByLabel('Renewed signing link',{exact:true})).toHaveValue('https://example.com/#/sign/fresh-share');expect(sends).toBe(2);
});
