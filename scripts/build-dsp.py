#!/usr/bin/env python3
"""Rebuild the shipped DSP binaries with Emscripten 4.0.20 (emcc on PATH)."""
from pathlib import Path
import os
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
PINS = {
    "eurorack": ("https://github.com/pichenettes/eurorack.git", "08460a69a7e1f7a81c5a2abcc7189c9a6b7208d4"),
    "stmlib": ("https://github.com/pichenettes/stmlib.git", "d18def816c51d1da0c108236928b2bbd25c17481"),
}

def run(*args, cwd=None):
    subprocess.run(args, cwd=cwd, check=True)

with tempfile.TemporaryDirectory(prefix="textured-dsp-") as folder:
    work = Path(folder)
    for name, (url, revision) in PINS.items():
        local = os.environ.get("DSP_" + name.upper())
        if local:
            source = Path(local)
            actual = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=source, text=True).strip()
            if actual != revision:
                raise RuntimeError(f"{name} must be at {revision}")
            shutil.copytree(source, work / name, ignore=shutil.ignore_patterns(".git"))
        else:
            run("git", "init", str(work / name))
            run("git", "fetch", "--depth=1", url, revision, cwd=work / name)
            run("git", "checkout", "--detach", "FETCH_HEAD", cwd=work / name)
    common = [str(work / "stmlib" / p) for p in ["utils/random.cc", "dsp/units.cc", "dsp/atan.cc"]]
    definitions = {
        "plaits": (["plaits/dsp"], "p_init,p_render,p_out,p_aux"),
        "marbles": (["marbles/random", "marbles/ramp"], "m_init,m_render,m_clock,m_t1,m_t2,m_t3,m_x1,m_x2,m_x3,m_y"),
    }
    for name, (directories, exports) in definitions.items():
        sources = [str(ROOT / "dsp" / (name + ".cc")), str(work / "eurorack" / name / "resources.cc")]
        for directory in directories:
            sources += [str(p) for p in sorted((work / "eurorack" / directory).rglob("*.cc"))]
        run(os.environ.get("EMCC", "emcc"), "-O3", "-std=c++17", "-DTEST", "-I" + str(work / "eurorack"), "-I" + str(work), "--no-entry",
            "-sEXPORTED_FUNCTIONS=" + ",".join("_" + e for e in exports.split(",")),
            "-sALLOW_MEMORY_GROWTH=0", "-sINITIAL_MEMORY=16777216", "-o", str(ROOT / "public/audio" / (name + ".wasm")), *sources, *common)
        print("Built", name)
