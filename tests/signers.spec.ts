import { test, expect } from "@playwright/test";
import { PDFDocument } from "pdf-lib";

test("document signer roster excludes unselected contacts and signatures apply one box at a time", async ({page}) => {
  let documentSignersReady = false;
  const contacts = [
    {id:"alice",first_name:"Alice",last_name:"Chen",email:"alice@example.com"},
    {id:"bob",first_name:"Bob",last_name:"Wu",email:"bob@example.com"},
    {id:"carol",first_name:"Carol",last_name:"Lin",email:"carol@example.com"},
  ];
  const pdf=await PDFDocument.create();pdf.addPage([600,800]);
  const bytes=Buffer.from(await pdf.save());
  const doc:any={id:"33333333-3333-4333-8333-333333333333",title:"Selected signers",status:"draft",original_path:"original.pdf",draft_revision:0,signers:[],created_at:new Date().toISOString(),fields:[
    {id:"signature-one",page:1,type:"signature",signer:"company",x:0.1,y:0.2,width:0.25,height:0.04},
    {id:"signature-two",page:1,type:"signature",signer:"company",x:0.1,y:0.4,width:0.25,height:0.04},
    {id:"date-one",page:1,type:"date",signer:"company",x:0.1,y:0.6,width:0.14,height:0.028},
  ]};
  await page.addInitScript(()=>localStorage.setItem("sb-test-auth-token",JSON.stringify({access_token:"eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.fake",refresh_token:"test",expires_at:Math.floor(Date.now()/1000)+3600,token_type:"bearer",user:{id:"test",email:"readyreadymotors9999@gmail.com",aud:"authenticated"}})));
  await page.route("**/signers.pdf",route=>route.fulfill({contentType:"application/pdf",body:bytes}));
  await page.route("https://test.supabase.co/**",async route=>{
    if(route.request().url().includes("/rest/v1/documents")) return route.fulfill({json:[doc]});
    const body=route.request().postDataJSON();
    if(body.action==="recipients")return route.fulfill({json:{recipients:contacts}});
    if(body.action==="detail")return route.fulfill({json:{document:doc,audit:[],url:"/signers.pdf",capabilities:{draftAutosave:true,draftRestore:true,documentSigners:documentSignersReady}}});
    if(body.action==="save_recipient") {
      let contact=contacts.find(contact=>contact.id===body.recipientId);
      if(!contact){ contact={id:"dave",first_name:body.firstName,last_name:body.lastName,email:body.email};contacts.push(contact); }
      return route.fulfill({json:{recipient:contact}});
    }
    if(body.action==="save_draft"){
      expect(body.revision).toBe(doc.draft_revision);doc.fields=body.fields;doc.signers=body.signers;doc.draft_revision++;
      return route.fulfill({json:{revision:doc.draft_revision}});
    }
    return route.fulfill({status:400,json:{error:"Unexpected action"}});
  });
  await page.goto("/");
  await page.getByRole("button",{name:/PDF Selected signers/}).click();
  const signer=page.getByLabel("Field signer",{exact:true});
  await expect(signer).toHaveValue("company");
  await expect(signer.locator("option")).toHaveCount(3);
  await expect(signer).not.toContainText("Alice");await expect(signer).not.toContainText("Carol");
  await signer.selectOption("manage");
  await page.getByLabel("Saved recipient").selectOption("alice");
  await expect(page.getByRole("button",{name:"Add as signer",exact:true})).toBeDisabled();
  await expect(page.getByText("Adding document signers is not enabled on the server yet.",{exact:false})).toBeVisible();
  documentSignersReady = true;
  await page.reload();
  await page.getByRole("button",{name:/PDF Selected signers/}).click();
  const first=page.getByRole("button",{name:"Open company signature field 1 on page 1",exact:true});
  await first.click();
  await page.getByRole("dialog").getByRole("button",{name:"Add signature",exact:true}).click();
  await expect(page.locator(".field-content img")).toHaveCount(1);
  await page.getByRole("button",{name:"Open company signature field 2 on page 1",exact:true}).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".field-content img")).toHaveCount(2);
  await first.click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button",{name:"Field settings 1",exact:true}).click();
  await page.getByRole("menuitem",{name:"Change signature style",exact:true}).click();
  await expect(page.getByRole("dialog").getByAltText("Current signature")).toBeVisible();
  await page.getByRole("button",{name:"Close signature dialog",exact:true}).click();
  for(const contact of contacts.slice(0,2)){
    await signer.selectOption("manage");
    await page.getByLabel("Saved recipient").selectOption(contact.id);
    await expect(signer).not.toContainText(contact.first_name);
    await page.getByRole("button",{name:"Add as signer",exact:true}).click();
    await expect(signer).toContainText(contact.first_name);
  }
  await expect(signer.locator("option")).toHaveCount(5);
  await expect(signer).not.toContainText("Carol");
  await first.click();
  const owners=page.getByLabel("Signer for field 1",{exact:true});
  await expect(owners.locator("option")).toHaveCount(3);
  await expect(owners).toContainText("Alice Chen");await expect(owners).toContainText("Bob Wu");await expect(owners).not.toContainText("Carol");
  await signer.selectOption("new");
  await expect(page.getByLabel("Saved recipient")).toHaveCount(0);
  await expect(page.getByRole("button",{name:"Add new signer",exact:true})).toHaveAttribute("aria-pressed","true");
  await page.getByLabel("Recipient first name").fill("Dave");
  await page.getByLabel("Recipient last name").fill("Park");
  await page.getByLabel("Recipient email").fill("dave@example.com");
  await page.getByRole("button",{name:"Save and add as signer",exact:true}).click();
  await expect(signer).toContainText("Dave Park");
  await page.getByRole("button",{name:"Save draft",exact:true}).click();
  await expect(page.getByText("Document saved",{exact:true})).toBeVisible();
  await expect(page.getByText("Document saved",{exact:true})).toHaveCount(0);
  expect(doc.signers.map((signer:any)=>signer.email)).toEqual(["alice@example.com","bob@example.com","dave@example.com"]);
  await page.reload();await page.getByRole("button",{name:/PDF Selected signers/}).click();
  await expect(page.getByLabel("Field signer",{exact:true}).locator("option")).toHaveCount(6);
  await expect(page.locator(".field-content img")).toHaveCount(0);
});
