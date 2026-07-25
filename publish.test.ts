Deno.test("deno publish dry-run succeeds", async () => {
  const args = ["publish", "--dry-run", "--allow-dirty"];
  const command = new Deno.Command(Deno.execPath(), {
    args,
    stdout: "piped",
    stderr: "piped",
  });

  const { code, stdout, stderr } = await command.output();
  if (code !== 0) {
    const decoder = new TextDecoder();
    throw new Error([
      `deno publish failed with exit code ${code}`,
      "--- stdout ---",
      decoder.decode(stdout),
      "--- stderr ---",
      decoder.decode(stderr),
    ].join("\n"));
  }
});
