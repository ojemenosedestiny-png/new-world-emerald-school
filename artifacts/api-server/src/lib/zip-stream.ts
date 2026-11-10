import { crc32, deflateRawSync } from "node:zlib";
import type { Writable } from "node:stream";

/**
 * A small ZIP writer that streams entries one at a time (so a school's photos never sit in memory together).
 * Text files are deflated; photos are stored as they are (already compressed). No ZIP64: fine below 4 GB.
 */
export class ZipStream {
  private offset = 0;
  private central: Buffer[] = [];
  private names = new Set<string>();
  constructor(private out: Writable) {}

  private write(buf: Buffer) {
    this.offset += buf.length;
    return new Promise<void>((resolve, reject) => {
      if (this.out.write(buf)) resolve();
      else { this.out.once("drain", resolve); this.out.once("error", reject); }
    });
  }

  /** A name that is safe in every operating system, and unique in the archive. */
  uniqueName(path: string) {
    const clean = path.split("/").map((p) => p.replace(/[<>:"\\|?*\x00-\x1f]/g, "").replace(/\s+/g, " ").trim() || "_").join("/");
    let name = clean, n = 2;
    while (this.names.has(name.toLowerCase())) { name = clean.replace(/(\.[^./]+)?$/, ` (${n++})$1`); }
    this.names.add(name.toLowerCase());
    return name;
  }

  async add(path: string, data: Buffer, compress = true) {
    const name = Buffer.from(this.uniqueName(path), "utf8");
    const body = compress ? deflateRawSync(data) : data;
    const method = compress ? 8 : 0;
    const crc = crc32(data) >>> 0;
    const now = new Date();
    const time = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
    const date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10); local.writeUInt16LE(date, 12); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(name.length, 26); local.writeUInt16LE(0, 28);
    const at = this.offset;
    await this.write(local); await this.write(name); await this.write(body);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0); entry.writeUInt16LE(20, 4); entry.writeUInt16LE(20, 6); entry.writeUInt16LE(0x0800, 8); entry.writeUInt16LE(method, 10);
    entry.writeUInt16LE(time, 12); entry.writeUInt16LE(date, 14); entry.writeUInt32LE(crc, 16); entry.writeUInt32LE(body.length, 20); entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(name.length, 28); entry.writeUInt32LE(at, 42);
    this.central.push(entry, name);
  }

  async finish() {
    const start = this.offset;
    const dir = Buffer.concat(this.central);
    await this.write(dir);
    const end = Buffer.alloc(22);
    const count = this.central.length / 2;
    end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(count, 8); end.writeUInt16LE(count, 10);
    end.writeUInt32LE(dir.length, 12); end.writeUInt32LE(start, 16);
    await this.write(end);
    this.out.end();
  }
}

/** One spreadsheet cell: quoted when needed, and never read by Excel as a formula. */
export function csvCell(v: unknown) {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
/** A CSV file Excel opens straight away (UTF-8 with a byte-order mark, Windows line endings). */
export function csv(head: string[], rows: unknown[][]) {
  return Buffer.from("\ufeff" + [head, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n", "utf8");
}
