import { pageTextOf, READ_PAGE_TEXT } from "@instrument-org/shared/page-text";
import { afterEach, expect, it } from "vitest";
import { userEvent } from "vitest/browser";

afterEach(() => {
  document.body.innerHTML = "";
});

/** What `instrument window read` hands back for the document as it is now. */
function read(): string | undefined {
  // oxlint-disable-next-line no-eval -- the script is a string a guest page runs, so the test runs it the same way
  const raw: unknown = (0, eval)(READ_PAGE_TEXT);
  return pageTextOf(raw);
}

const FORM = `<h1>Checkout</h1>
<form>
<p><label>Full name <input name="name"></label></p>
<p><label for="pw">Password</label> <input id="pw" type="password"></p>
<p><label>Delivery notes <textarea name="notes"></textarea></label></p>
<p><label>Size <select name="size"><option>Small</option><option>Large</option></select></label></p>
<p><label><input type="checkbox" name="gift"> Gift wrap</label></p>
<input type="hidden" name="token" value="secret">
<p style="display:none"><label>Unseen <input name="unseen" value="x"></label></p>
<button type="submit">Place order</button>
</form>`;

it("tells a filled form from an empty one, masking the password", async () => {
  document.body.innerHTML = FORM;
  const empty = read();
  expect(empty).toMatchInlineSnapshot(`
    "Checkout

    Full name 

    Password 

    Delivery notes 

    Size 
    Small
    Large

     Gift wrap

    Place order

    Form fields, as they are filled in now:
    Full name: empty
    Password (password): empty
    Delivery notes (text area): empty
    Size (select): "Small"
    Gift wrap (checkbox): not checked"
  `);

  await userEvent.type(
    document.querySelector("input[name=name]")!,
    "Sam Rivera",
  );
  await userEvent.type(document.querySelector("#pw")!, "hunter2");
  await userEvent.type(document.querySelector("textarea")!, "Ring twice");
  await userEvent.selectOptions(document.querySelector("select")!, "Large");
  await userEvent.click(document.querySelector("input[type=checkbox]")!);

  const filled = read();
  expect(filled?.slice(filled.indexOf("Form fields"))).toMatchInlineSnapshot(`
    "Form fields, as they are filled in now:
    Full name: "Sam Rivera"
    Password (password): filled, hidden here
    Delivery notes (text area): "Ring twice"
    Size (select): "Large"
    Gift wrap (checkbox): checked"
  `);
  expect(filled).not.toContain("hunter2");
  expect(filled).not.toContain("secret");
});

it("adds nothing to a page with no fields", () => {
  document.body.innerHTML = "<p>Just words.</p>";
  expect(read()).toBe("Just words.");
});
