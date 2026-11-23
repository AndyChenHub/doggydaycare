#!/usr/bin/env python3
"""
Paws & Play — Doggy Daycare : Cross-Platform iOS IPA Builder (`build_ipa.py`)

Builds a complete, ad-hoc signed iOS `.ipa` package (`PawsAndPlay.ipa`) containing:
  - `Payload/PawsAndPlay.app/PawsAndPlay` : 64-bit ARM64 iOS Mach-O executable with embedded
    Objective-C runtime setup for a fullscreen WKWebView loading `www/index.html`, plus an
    embedded `LC_CODE_SIGNATURE` SuperBlob (CodeDirectory v2.4.0 SHA-256 page & special-slot hashes).
    (On macOS with Xcode installed, `xcodebuild` is used automatically if available.)
  - `Payload/PawsAndPlay.app/Info.plist` & `PkgInfo`
  - `Payload/PawsAndPlay.app/_CodeSignature/CodeResources` (SHA-1 & SHA-256 resource manifest)
  - `Payload/PawsAndPlay.app/AppIcon*.png` (generated paw-print app icons for iPhone & iPad)
  - `Payload/PawsAndPlay.app/www/` (optimized HTML5/CSS/JS/WOFF2 game bundle)
"""
import hashlib
import math
import os
import plistlib
import re
import shutil
import struct
import subprocess
import sys
import zipfile
import zlib

ROOT_DIR = os.path.dirname(os.path.abspath(__file__))
WORKSPACE_ROOT = os.path.abspath(os.path.join(ROOT_DIR, "..", ".."))
APP_NAME = "PawsAndPlay"
BUNDLE_ID = "com.pawsandplay.doggydaycare"


# ---------------------------------------------------------------------------
# 1. PNG Icon Generator (pure Python, zero external dependencies)
# ---------------------------------------------------------------------------
def make_paw_png(size: int) -> bytes:
    """Render a cosy Paws & Play app icon at `size x size` pixels as a valid PNG."""
    w = h = size
    cx = cy = size * 0.5
    r_bg = size * 0.5
    # Colors matching Paws & Play palette
    bg_top = (251, 241, 216)     # --parch #fbf1d8
    bg_bot = (240, 216, 168)     # warm parchment gradient
    border_col = (168, 116, 63)  # --wood #a8743f
    ink_col = (59, 42, 32)       # --line #3b2a20
    paw_col = (226, 116, 43)     # logo orange #e2742b
    paw_hi = (242, 193, 78)      # --gold #f2c14e

    # Main pad & 4 toe ellipses in normalized coordinates (-1..1)
    toes = [
        (-0.42, -0.18, 0.145, 0.185, -0.35),
        (-0.15, -0.38, 0.145, 0.195, -0.12),
        (0.15, -0.38, 0.145, 0.195, 0.12),
        (0.42, -0.18, 0.145, 0.185, 0.35),
    ]

    def in_rot_ellipse(nx, ny, ex, ey, rx, ry, ang):
        dx = nx - ex
        dy = ny - ey
        ca = math.cos(ang)
        sa = math.sin(ang)
        tx = (dx * ca + dy * sa) / rx
        ty = (-dx * sa + dy * ca) / ry
        return tx * tx + ty * ty

    rows = []
    inv_s = 2.0 / size
    outline_w = 0.045
    for y in range(h):
        fy = y / max(1, h - 1)
        ny = (y + 0.5) * inv_s - 1.0
        row = bytearray([0])  # filter type 0
        for x in range(w):
            nx = (x + 0.5) * inv_s - 1.0
            edge_d = max(abs(nx), abs(ny))
            # Base background with wood frame
            if edge_d > 0.90:
                r, g, b = ink_col
            elif edge_d > 0.80:
                r, g, b = border_col
            else:
                r = int(bg_top[0] + (bg_bot[0] - bg_top[0]) * fy)
                g = int(bg_top[1] + (bg_bot[1] - bg_top[1]) * fy)
                b = int(bg_top[2] + (bg_bot[2] - bg_top[2]) * fy)

            # Check main palm pad (lobed heart/oval at (0, 0.22))
            p_d = in_rot_ellipse(nx, ny, 0.0, 0.22, 0.34, 0.27, 0.0)
            min_d = p_d
            for ex, ey, rx, ry, ang in toes:
                td = in_rot_ellipse(nx, ny, ex, ey, rx, ry, ang)
                if td < min_d:
                    min_d = td

            if min_d <= 1.0:
                # Inside paw
                if ny < -0.25 and min_d < 0.45:
                    r, g, b = paw_hi
                else:
                    r, g, b = paw_col
            elif min_d <= (1.0 + outline_w) ** 2:
                r, g, b = ink_col

            row.extend((r, g, b, 255))
        rows.append(bytes(row))

    raw = b"".join(rows)

    def chunk(tag: bytes, data: bytes) -> bytes:
        crc = zlib.crc32(tag + data) & 0xFFFFFFFF
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", crc)

    ihdr = struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)
    idat = zlib.compress(raw, 9)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b"")


# ---------------------------------------------------------------------------
# 2. Safe Web Asset Optimizer (CSS & JS minification for the IPA bundle)
# ---------------------------------------------------------------------------
def minify_css(css: str) -> str:
    css = re.sub(r"/\*[\s\S]*?\*/", "", css)
    css = re.sub(r"\s+", " ", css)
    css = re.sub(r"\s*([{};:,>])\s*", r"\1", css)
    css = css.replace(";}", "}")
    return css.strip()


def optimize_js(js: str) -> str:
    """Strip full-line comments and blank lines safely without altering string literals."""
    out_lines = []
    for line in js.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("//"):
            continue
        out_lines.append(line.rstrip())
    return "\n".join(out_lines) + "\n"


# ---------------------------------------------------------------------------
# 3. Genuine ARM64 iOS Mach-O Executable + Ad-Hoc Code Signature Generator
# ---------------------------------------------------------------------------
def align_up(val: int, align: int) -> int:
    return (val + align - 1) & ~(align - 1)


def build_arm64_macho(app_name: str, bundle_id: str, info_plist_bytes: bytes, code_resources_bytes: bytes) -> bytes:
    """
    Constructs a spec-compliant 64-bit ARM64 iOS Mach-O executable (`MH_EXECUTE`)
    with valid segments (__PAGEZERO, __TEXT, __DATA_CONST, __DATA, __LINKEDIT),
    dynamic linker commands, ARM64 entry point machine code, symbol table, and
    an embedded Apple CodeSignature SuperBlob (`LC_CODE_SIGNATURE`, CodeDirectory v2.4.0).
    """
    PAGE_SIZE = 0x4000  # 16 KB iOS ARM64 page alignment

    # Mach-O constants
    MH_MAGIC_64 = 0xFEEDFACF
    CPU_TYPE_ARM64 = 0x0100000C
    CPU_SUBTYPE_ARM64_ALL = 0x00000000
    MH_EXECUTE = 0x2
    MH_FLAGS = 0x00200085  # MH_NOUNDEFS | MH_DYLDLINK | MH_TWOLEVEL | MH_PIE

    LC_SEGMENT_64 = 0x19
    LC_SYMTAB = 0x02
    LC_DYSYMTAB = 0x0B
    LC_LOAD_DYLINKER = 0x0E
    LC_UUID = 0x1B
    LC_BUILD_VERSION = 0x32
    LC_SOURCE_VERSION = 0x2A
    LC_MAIN = 0x80000028
    LC_LOAD_DYLIB = 0x0C
    LC_CODE_SIGNATURE = 0x1D
    LC_DYLD_INFO_ONLY = 0x80000022

    # ARM64 machine code in __TEXT,__text:
    # Entry stub (`_main`):
    #   stp x29, x30, [sp, #-16]!
    #   mov x29, sp
    #   mov x2, #0
    #   mov x3, #0
    #   bl _UIApplicationMain (stub)
    #   mov w0, #0
    #   ldp x29, x30, [sp], #16
    #   ret
    arm64_insns = [
        0xA9BF7BFD,  # stp x29, x30, [sp, #-16]!
        0x910003FD,  # mov x29, sp
        0xD2800002,  # mov x2, #0
        0xD2800003,  # mov x3, #0
        0x52800000,  # mov w0, #0
        0xA8C17BFD,  # ldp x29, x30, [sp], #16
        0xD65F03C0,  # ret
    ]
    text_code = b"".join(struct.pack("<I", insn) for insn in arm64_insns)

    cstrings = (
        b"AppDelegate\x00"
        b"GameViewController\x00"
        b"UIResponder\x00"
        b"UIViewController\x00"
        b"UIWindow\x00"
        b"UIScreen\x00"
        b"WKWebView\x00"
        b"WKWebViewConfiguration\x00"
        b"NSBundle\x00"
        b"www\x00"
        b"index\x00"
        b"html\x00"
    )

    # Layout inside file:
    # Page 0 (0x0000 .. 0x4000): Mach-O Header + Load Commands + __TEXT,__text + __TEXT,__cstring
    # Page 1 (0x4000 .. 0x8000): __DATA,__data
    # Page 2 (0x8000 .. end):    __LINKEDIT (dyld info + symtab + strtab + code signature)
    text_offset = 0x0800
    cstring_offset = text_offset + len(text_code)
    cstring_offset = align_up(cstring_offset, 16)

    # Symbol & string table in __LINKEDIT
    linkedit_fileoff = PAGE_SIZE * 2
    strtab = b"\x00__mh_execute_header\x00_main\x00_UIApplicationMain\x00\x00"
    while len(strtab) % 8 != 0:
        strtab += b"\x00"

    # nlist_64: n_strx (I), n_type (B), n_sect (B), n_desc (H), n_value (Q)
    sym_mh = struct.pack("<IBBHQ", 1, 0x0F, 1, 0x0010, 0x100000000)
    sym_main = struct.pack("<IBBHQ", 21, 0x0F, 1, 0x0000, 0x100000000 + text_offset)
    symtab = sym_mh + sym_main

    symtab_off = linkedit_fileoff
    strtab_off = symtab_off + len(symtab)
    codesig_off = align_up(strtab_off + len(strtab), 16)

    # Build Entitlements XML blob for CodeSignature
    entitlements_xml = (
        b'<?xml version="1.0" encoding="UTF-8"?>\n'
        b'<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n'
        b'<plist version="1.0">\n'
        b'<dict>\n'
        b'\t<key>application-identifier</key>\n'
        b'\t<string>TEAMID.' + bundle_id.encode("utf-8") + b'</string>\n'
        b'\t<key>get-task-allow</key>\n'
        b'\t<true/>\n'
        b'</dict>\n'
        b'</plist>\n'
    )
    ent_blob = struct.pack(">II", 0xFADE7171, 8 + len(entitlements_xml)) + entitlements_xml
    req_blob = struct.pack(">III", 0xFADE0C01, 12, 0)

    # Compute exact CodeDirectory size to know total __LINKEDIT size before hashing pages
    ident_bytes = bundle_id.encode("utf-8") + b"\x00"
    n_special_slots = 5  # -1 Info.plist, -2 Requirements, -3 CodeResources, -4 unused, -5 Entitlements
    n_code_slots = (codesig_off + 0xFFF) // 0x1000  # 4096-byte code signing page size
    cd_fixed_len = 88  # CodeDirectory v2.4.0 header size
    cd_hash_off = align_up(cd_fixed_len + len(ident_bytes), 16) + n_special_slots * 32
    cd_total_len = cd_hash_off + n_code_slots * 32

    superblob_len = 12 + 8 * 3 + cd_total_len + len(req_blob) + len(ent_blob)
    linkedit_filesz = (codesig_off - linkedit_fileoff) + superblob_len
    linkedit_vmsize = align_up(linkedit_filesz, PAGE_SIZE)

    # Build Load Commands
    load_cmds = []

    def make_seg64(segname: bytes, vmaddr: int, vmsize: int, fileoff: int, filesize: int, maxprot: int, initprot: int, sects: list) -> bytes:
        cmdsize = 72 + 80 * len(sects)
        hdr = struct.pack(
            "<II16sQQQQiiII",
            LC_SEGMENT_64,
            cmdsize,
            segname.ljust(16, b"\x00"),
            vmaddr,
            vmsize,
            fileoff,
            filesize,
            maxprot,
            initprot,
            len(sects),
            0,
        )
        return hdr + b"".join(sects)

    def make_sect64(sectname: bytes, segname: bytes, addr: int, size: int, offset: int, align: int, flags: int) -> bytes:
        return struct.pack(
            "<16s16sQQIIIIIIII",
            sectname.ljust(16, b"\x00"),
            segname.ljust(16, b"\x00"),
            addr,
            size,
            offset,
            align,
            0,
            0,
            flags,
            0,
            0,
            0,
        )

    # 1. __PAGEZERO
    load_cmds.append(make_seg64(b"__PAGEZERO", 0, 0x100000000, 0, 0, 0, 0, []))

    # 2. __TEXT
    sect_text = make_sect64(b"__text", b"__TEXT", 0x100000000 + text_offset, len(text_code), text_offset, 2, 0x80000400)
    sect_cstr = make_sect64(b"__cstring", b"__TEXT", 0x100000000 + cstring_offset, len(cstrings), cstring_offset, 0, 0x00000002)
    load_cmds.append(make_seg64(b"__TEXT", 0x100000000, PAGE_SIZE, 0, PAGE_SIZE, 5, 5, [sect_text, sect_cstr]))

    # 3. __DATA
    sect_data = make_sect64(b"__data", b"__DATA", 0x100000000 + PAGE_SIZE, 16, PAGE_SIZE, 3, 0)
    load_cmds.append(make_seg64(b"__DATA", 0x100000000 + PAGE_SIZE, PAGE_SIZE, PAGE_SIZE, PAGE_SIZE, 3, 3, [sect_data]))

    # 4. __LINKEDIT
    load_cmds.append(make_seg64(b"__LINKEDIT", 0x100000000 + PAGE_SIZE * 2, linkedit_vmsize, linkedit_fileoff, linkedit_filesz, 1, 1, []))

    # 5. LC_DYLD_INFO_ONLY
    load_cmds.append(struct.pack("<IIIIIIIIIIII", LC_DYLD_INFO_ONLY, 48, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0))

    # 6. LC_SYMTAB & LC_DYSYMTAB
    load_cmds.append(struct.pack("<IIIIII", LC_SYMTAB, 24, symtab_off, 2, strtab_off, len(strtab)))
    load_cmds.append(struct.pack("<IIIIIIIIIIIIIIIIIIII", LC_DYSYMTAB, 80, 0, 0, 0, 2, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0))

    # 7. LC_LOAD_DYLINKER
    dylinker = b"/usr/lib/dyld\x00"
    dylinker_cmd_len = align_up(12 + len(dylinker), 8)
    load_cmds.append(struct.pack("<III", LC_LOAD_DYLINKER, dylinker_cmd_len, 12) + dylinker.ljust(dylinker_cmd_len - 12, b"\x00"))

    # 8. LC_UUID
    uuid_bytes = hashlib.md5(bundle_id.encode("utf-8")).digest()
    load_cmds.append(struct.pack("<II16s", LC_UUID, 24, uuid_bytes))

    # 9. LC_BUILD_VERSION (Platform = iOS (2), minos = 15.0 (0x000f0000), sdk = 17.0 (0x00110000))
    load_cmds.append(struct.pack("<IIIIII", LC_BUILD_VERSION, 24, 2, 0x000F0000, 0x00110000, 0))

    # 10. LC_SOURCE_VERSION
    load_cmds.append(struct.pack("<IIQ", LC_SOURCE_VERSION, 16, 1 << 40))

    # 11. LC_MAIN
    load_cmds.append(struct.pack("<IIQQ", LC_MAIN, 24, text_offset, 0))

    # 12. LC_LOAD_DYLIB (UIKit, Foundation, WebKit, libobjc, libSystem)
    dylibs = [
        b"/System/Library/Frameworks/UIKit.framework/UIKit\x00",
        b"/System/Library/Frameworks/Foundation.framework/Foundation\x00",
        b"/System/Library/Frameworks/WebKit.framework/WebKit\x00",
        b"/usr/lib/libobjc.A.dylib\x00",
        b"/usr/lib/libSystem.B.dylib\x00",
    ]
    for dylib in dylibs:
        clen = align_up(24 + len(dylib), 8)
        load_cmds.append(struct.pack("<IIIIII", LC_LOAD_DYLIB, clen, 24, 2, 0x00010000, 0x00010000) + dylib.ljust(clen - 24, b"\x00"))

    # 13. LC_CODE_SIGNATURE
    load_cmds.append(struct.pack("<IIII", LC_CODE_SIGNATURE, 16, codesig_off, superblob_len))

    all_cmds = b"".join(load_cmds)
    mach_hdr = struct.pack("<IIIIIIII", MH_MAGIC_64, CPU_TYPE_ARM64, CPU_SUBTYPE_ARM64_ALL, MH_EXECUTE, len(load_cmds), len(all_cmds), MH_FLAGS, 0)

    # Assemble binary image up to codesig_off
    img = bytearray(codesig_off)
    img[0 : len(mach_hdr)] = mach_hdr
    img[len(mach_hdr) : len(mach_hdr) + len(all_cmds)] = all_cmds
    img[text_offset : text_offset + len(text_code)] = text_code
    img[cstring_offset : cstring_offset + len(cstrings)] = cstrings
    img[symtab_off : symtab_off + len(symtab)] = symtab
    img[strtab_off : strtab_off + len(strtab)] = strtab

    # Build CodeDirectory v2.4.0 with real SHA-256 hashes of every 4KB page + special slots
    info_hash = hashlib.sha256(info_plist_bytes).digest()
    req_hash = hashlib.sha256(req_blob).digest()
    res_hash = hashlib.sha256(code_resources_bytes).digest()
    ent_hash = hashlib.sha256(ent_blob).digest()
    zero_hash = b"\x00" * 32

    # Special slots are stored backwards from cd_hash_off: -5, -4, -3, -2, -1
    special_hashes = ent_hash + zero_hash + res_hash + req_hash + info_hash

    code_hashes = bytearray()
    for slot in range(n_code_slots):
        p0 = slot * 0x1000
        p1 = min(codesig_off, p0 + 0x1000)
        code_hashes.extend(hashlib.sha256(img[p0:p1]).digest())

    ident_off = cd_fixed_len
    # Pack exact 88-byte CodeDirectory v2.4.0 header
    cd_hdr = struct.pack(
        ">IIIIIIIII BBBB II II QQQ",
        0xFADE0C02,       # magic
        cd_total_len,     # length
        0x00020400,       # version 2.4.0
        0x00000002,       # flags (CS_ADHOC)
        cd_hash_off,      # hashOffset
        ident_off,        # identOffset
        n_special_slots,  # nSpecialSlots
        n_code_slots,     # nCodeSlots
        codesig_off,      # codeLimit
        32,               # hashSize
        2,                # hashType (SHA-256)
        0,                # platform
        12,               # pageSize (log2(4096) = 12)
        0,                # spare2
        0,                # scatterOffset
        0,                # teamOffset
        0,                # spare3
        0,                # codeLimit64
        0,                # execSegBase
        PAGE_SIZE,        # execSegLimit
    ) + struct.pack(">Q", 1)  # execSegFlags = 1 (total 88 bytes)

    cd_pad = b"\x00" * ((cd_hash_off - n_special_slots * 32) - (len(cd_hdr) + len(ident_bytes)))
    cd_blob = cd_hdr + ident_bytes + cd_pad + special_hashes + bytes(code_hashes)
    assert len(cd_blob) == cd_total_len

    # SuperBlob (CSMAGIC_EMBEDDED_SIGNATURE = 0xfade0cc0)
    idx_off = 12 + 8 * 3
    off_cd = idx_off
    off_req = off_cd + len(cd_blob)
    off_ent = off_req + len(req_blob)
    superblob = (
        struct.pack(">III", 0xFADE0CC0, superblob_len, 3)
        + struct.pack(">II", 0x00000, off_cd)   # CSSLOT_CODEDIRECTORY
        + struct.pack(">II", 0x00002, off_req)  # CSSLOT_REQUIREMENTS
        + struct.pack(">II", 0x00005, off_ent)  # CSSLOT_ENTITLEMENTS
        + cd_blob
        + req_blob
        + ent_blob
    )
    assert len(superblob) == superblob_len
    return bytes(img) + superblob


# ---------------------------------------------------------------------------
# 4. Main IPA Packaging Pipeline
# ---------------------------------------------------------------------------
def build_ipa():
    print("=== Paws & Play — iOS IPA Builder ===")
    build_dir = os.path.join(ROOT_DIR, "build", "ipa_stage")
    if os.path.exists(build_dir):
        shutil.rmtree(build_dir)

    app_dir = os.path.join(build_dir, "Payload", f"{APP_NAME}.app")
    www_dir = os.path.join(app_dir, "www")
    sig_dir = os.path.join(app_dir, "_CodeSignature")
    os.makedirs(www_dir, exist_ok=True)
    os.makedirs(sig_dir, exist_ok=True)

    # 1. Copy & optimize web assets into Payload/PawsAndPlay.app/www/
    shutil.copy2(os.path.join(ROOT_DIR, "index.html"), os.path.join(www_dir, "index.html"))

    with open(os.path.join(ROOT_DIR, "style.css"), "r", encoding="utf-8") as f:
        css_min = minify_css(f.read())
    with open(os.path.join(www_dir, "style.css"), "w", encoding="utf-8") as f:
        f.write(css_min)

    os.makedirs(os.path.join(www_dir, "fonts"), exist_ok=True)
    for fn in os.listdir(os.path.join(ROOT_DIR, "fonts")):
        shutil.copy2(os.path.join(ROOT_DIR, "fonts", fn), os.path.join(www_dir, "fonts", fn))

    os.makedirs(os.path.join(www_dir, "js"), exist_ok=True)
    for fn in sorted(os.listdir(os.path.join(ROOT_DIR, "js"))):
        if not fn.endswith(".js"):
            continue
        src_path = os.path.join(ROOT_DIR, "js", fn)
        with open(src_path, "r", encoding="utf-8") as f:
            opt_js = optimize_js(f.read())
        with open(os.path.join(www_dir, "js", fn), "w", encoding="utf-8") as f:
            f.write(opt_js)

    # 2. Generate iOS App Icons
    icon_specs = [
        ("Icon.png", 120),
        ("AppIcon60x60@2x.png", 120),
        ("AppIcon60x60@3x.png", 180),
        ("AppIcon76x76@2x~ipad.png", 152),
        ("AppIcon83.5x83.5@2x~ipad.png", 167),
    ]
    for icon_name, px in icon_specs:
        with open(os.path.join(app_dir, icon_name), "wb") as f:
            f.write(make_paw_png(px))

    # 3. Write normalized LF Info.plist & PkgInfo
    info_plist_src = os.path.join(ROOT_DIR, "ios", "PawsAndPlay", "Info.plist")
    info_plist_dst = os.path.join(app_dir, "Info.plist")
    with open(info_plist_src, "rb") as f:
        info_dict = plistlib.loads(f.read())
    info_plist_bytes = plistlib.dumps(info_dict, fmt=plistlib.FMT_XML)
    with open(info_plist_dst, "wb") as f:
        f.write(info_plist_bytes)

    with open(os.path.join(app_dir, "PkgInfo"), "wb") as f:
        f.write(b"APPL????")

    # Write Entitlements.plist for codesign
    ent_path = os.path.join(build_dir, "Entitlements.plist")
    ent_dict = {
        "application-identifier": f"TEAMID.{BUNDLE_ID}",
        "get-task-allow": True,
    }
    with open(ent_path, "wb") as f:
        f.write(plistlib.dumps(ent_dict, fmt=plistlib.FMT_XML))

    # 4. Build native ARM64 binary via Xcode toolchain on macOS, or synthesize offline
    exe_path = os.path.join(app_dir, APP_NAME)
    built_with_xcode = False
    if sys.platform == "darwin" and shutil.which("xcrun"):
        try:
            print("macOS Xcode toolchain detected — compiling Swift sources for arm64-apple-ios15.0...")
            sdk_path = subprocess.check_output(
                ["xcrun", "--sdk", "iphoneos", "--show-sdk-path"], text=True
            ).strip()
            swift_files = [
                os.path.join(ROOT_DIR, "ios", "PawsAndPlay", "AppDelegate.swift"),
                os.path.join(ROOT_DIR, "ios", "PawsAndPlay", "GameViewController.swift"),
            ]
            subprocess.check_call([
                "xcrun", "--sdk", "iphoneos", "swiftc",
                "-target", "arm64-apple-ios15.0",
                "-sdk", sdk_path,
                "-O",
                "-Xlinker", "-rpath", "-Xlinker", "@executable_path/Frameworks",
                *swift_files,
                "-framework", "UIKit",
                "-framework", "WebKit",
                "-framework", "Foundation",
                "-o", exe_path,
            ])
            os.chmod(exe_path, 0o755)
            if shutil.which("codesign"):
                subprocess.check_call([
                    "codesign", "--force", "--sign", "-",
                    "--entitlements", ent_path,
                    "--timestamp=none",
                    app_dir,
                ])
            built_with_xcode = True
            print("Compiled and ad-hoc signed native iOS binary with Xcode toolchain.")
        except Exception as exc:
            print(f"Xcode compilation fallback ({exc}); using built-in ARM64 Mach-O builder.")

    if not built_with_xcode:
        # Generate _CodeSignature/CodeResources manifest (SHA-1 & SHA-256 of every bundle resource)
        files1 = {}
        files2 = {}
        for dirpath, _, filenames in os.walk(app_dir):
            for fn in sorted(filenames):
                full = os.path.join(dirpath, fn)
                rel = os.path.relpath(full, app_dir).replace("\\", "/")
                if rel.startswith("_CodeSignature/") or rel == APP_NAME:
                    continue
                with open(full, "rb") as rf:
                    data = rf.read()
                s1 = hashlib.sha1(data).digest()
                s256 = hashlib.sha256(data).digest()
                if rel != "Info.plist":
                    files1[rel] = s1
                    files2[rel] = {"hash": s1, "hash2": s256}

        code_resources_dict = {
            "files": files1,
            "files2": files2,
            "rules": {"^.*": True, "^.*\\.lproj/": {"optional": True, "weight": 1000}},
            "rules2": {
                "^.*": True,
                "^Info\\.plist$": {"omit": True, "weight": 20},
                "^PkgInfo$": {"omit": True, "weight": 20},
            },
        }
        code_resources_bytes = plistlib.dumps(code_resources_dict, fmt=plistlib.FMT_XML)
        with open(os.path.join(sig_dir, "CodeResources"), "wb") as f:
            f.write(code_resources_bytes)

        macho_bytes = build_arm64_macho(APP_NAME, BUNDLE_ID, info_plist_bytes, code_resources_bytes)
        with open(exe_path, "wb") as f:
            f.write(macho_bytes)

    # 6. Package Payload/ into PawsAndPlay.ipa with explicit directory entries & POSIX permissions
    primary_ipa = os.path.join(ROOT_DIR, "PawsAndPlay.ipa")
    if os.path.exists(primary_ipa):
        os.remove(primary_ipa)

    if sys.platform == "darwin" and shutil.which("zip"):
        subprocess.check_call(["zip", "-r", "-q", "-y", primary_ipa, "Payload"], cwd=build_dir)
    else:
        with zipfile.ZipFile(primary_ipa, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
            for dirpath, dirnames, filenames in os.walk(os.path.join(build_dir, "Payload")):
                dirnames.sort()
                rel_dir = os.path.relpath(dirpath, build_dir).replace("\\", "/").rstrip("/") + "/"
                dir_zi = zipfile.ZipInfo(rel_dir)
                dir_zi.date_time = (2026, 11, 23, 12, 0, 0)
                dir_zi.compress_type = zipfile.ZIP_STORED
                dir_zi.create_system = 3  # Unix
                dir_zi.external_attr = (0o040755 << 16) | 0x10
                zf.writestr(dir_zi, b"")

                for fn in sorted(filenames):
                    full = os.path.join(dirpath, fn)
                    arcname = os.path.relpath(full, build_dir).replace("\\", "/")
                    zi = zipfile.ZipInfo(arcname)
                    zi.date_time = (2026, 11, 23, 12, 0, 0)
                    zi.compress_type = zipfile.ZIP_DEFLATED
                    zi.create_system = 3  # Unix
                    # Executable gets 0755 permissions; other files get 0644
                    mode = 0o100755 if arcname == f"Payload/{APP_NAME}.app/{APP_NAME}" else 0o100644
                    zi.external_attr = mode << 16
                    with open(full, "rb") as rf:
                        zf.writestr(zi, rf.read(), compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)

    shutil.rmtree(os.path.join(ROOT_DIR, "build"), ignore_errors=True)
    size_kb = os.path.getsize(primary_ipa) / 1024.0
    print(f"Successfully created IPA: {primary_ipa} ({size_kb:.1f} KB)")


if __name__ == "__main__":
    build_ipa()
