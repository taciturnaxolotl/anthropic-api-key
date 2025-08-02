#!/usr/bin/env bun

const PORT = Number(Bun.env.PORT || 8787);

async function open(url: string) {
  const tryRun = async (cmd: string, ...args: string[]) => {
    try {
      await Bun.$`${[cmd, ...args]}`.quiet();
      return true;
    } catch {
      return false;
    }
  };
  if (process.platform === "darwin") {
    if (await tryRun("open", url)) return;
  } else if (process.platform === "win32") {
    if (await tryRun("cmd", "/c", "start", "", url)) return;
  } else {
    if (await tryRun("xdg-open", url)) return;
  }
}

await open(`http://localhost:${PORT}`);
