Deno.test("deno publish dry-run succeeds", async () => {
  const args = ["publish", "--dry-run", "--allow-dirty"];
  const command = new Deno.Command(Deno.execPath(), {
    args,
  });

  const { code, stderr } = await command.output();
  if (code !== 0) {
    const decoder = new TextDecoder();
    throw new Error(decoder.decode(stderr));
  }
});
