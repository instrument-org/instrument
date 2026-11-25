// A new tab in a split beside what is up, then the window's summary.
await menu("New Tab in Split");
await side("right").find("textbox", "Talk to Instrument").wait();
return (await state()).split("\nscreen:")[0];
