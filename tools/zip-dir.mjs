// 把目录打成 zip(存储、不压缩)。不依赖系统 zip,GitLab 的 node 镜像可以直接用。
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** @param {Buffer} buf */
function crc32(buf) {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let i = 0; i < 8; i += 1) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (~c) >>> 0;
}

/**
 * @param {string} srcDir
 * @param {string} outFile
 */
export async function zipDir(srcDir, outFile) {
  /** @type {{ abs: string, rel: string }[]} */
  const files = [];
  async function walk(dir) {
    for (const name of await readdir(dir)) {
      const abs = path.join(dir, name);
      const info = await stat(abs);
      if (info.isDirectory()) {
        await walk(abs);
        continue;
      }
      files.push({ abs, rel: path.relative(srcDir, abs).split(path.sep).join('/') });
    }
  }
  await walk(srcDir);
  files.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));

  /** @type {Buffer[]} */
  const parts = [];
  /** @type {Buffer[]} */
  const central = [];
  let offset = 0;
  for (const file of files) {
    const data = await readFile(file.abs);
    const name = Buffer.from(file.rel, 'utf8');
    if (data.length > 0xffffffff || name.length > 0xffff) {
      throw new Error(`文件过大或路径过长,无法打进 zip: ${file.rel}`);
    }
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    parts.push(local, name, data);

    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4);
    cen.writeUInt16LE(20, 6);
    cen.writeUInt16LE(0x0800, 8);
    cen.writeUInt16LE(0, 10);
    cen.writeUInt16LE(0, 12);
    cen.writeUInt16LE(0, 14);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(data.length, 20);
    cen.writeUInt32LE(data.length, 24);
    cen.writeUInt16LE(name.length, 28);
    cen.writeUInt16LE(0, 30);
    cen.writeUInt16LE(0, 32);
    cen.writeUInt16LE(0, 34);
    cen.writeUInt16LE(0, 36);
    cen.writeUInt32LE(0, 38);
    cen.writeUInt32LE(offset, 42);
    central.push(cen, name);
    offset += local.length + name.length + data.length;
  }

  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);
  await writeFile(outFile, Buffer.concat([...parts, centralBuf, eocd]));
}
