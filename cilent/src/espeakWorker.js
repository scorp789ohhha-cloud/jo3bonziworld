let createWav;

let resolveReady;
let ready = new Promise((res) => {
    resolveReady = res;
});

function timestamps() {
    return {
        timestamps: {
            access: new Date(),
            change: new Date(),
            modification: new Date(),
        },
    };
}

const MOUTH_SPRITES = { CL: 0, E1: 142, E2: 143, E3: 144, E4: 145, O2: 146, O1: 147 };
const PHONEME_TO_MOUTH = {
    "a": MOUTH_SPRITES.E3, "aa": MOUTH_SPRITES.E3, "a:": MOUTH_SPRITES.E3, "A:": MOUTH_SPRITES.E3, "A@": MOUTH_SPRITES.E3,
    "eI": MOUTH_SPRITES.E4, "E": MOUTH_SPRITES.E4, "3": MOUTH_SPRITES.O2, "3:": MOUTH_SPRITES.O2, "e@": MOUTH_SPRITES.E2,
    "i": MOUTH_SPRITES.E4, "i:": MOUTH_SPRITES.E4, "i@": MOUTH_SPRITES.E2, "i@3": MOUTH_SPRITES.E2, "I": MOUTH_SPRITES.E3,
    "I2": MOUTH_SPRITES.E3, "I#": MOUTH_SPRITES.E3, "aI": MOUTH_SPRITES.E4, "0": MOUTH_SPRITES.E3,
    "oU": MOUTH_SPRITES.O1, "O": MOUTH_SPRITES.E3, "O:": MOUTH_SPRITES.E3, "OI": MOUTH_SPRITES.O1, "O@": MOUTH_SPRITES.O2, "o@": MOUTH_SPRITES.O2,
    "aU": MOUTH_SPRITES.O1, "U": MOUTH_SPRITES.O1, "U@": MOUTH_SPRITES.O2, "u": MOUTH_SPRITES.O1, "u:": MOUTH_SPRITES.O1,
    "V": MOUTH_SPRITES.E4, "a#": MOUTH_SPRITES.E2, "@": MOUTH_SPRITES.E2, "@2": MOUTH_SPRITES.O2, "@-": MOUTH_SPRITES.O2,
    "b": MOUTH_SPRITES.CL, "d": MOUTH_SPRITES.E1, "f": MOUTH_SPRITES.E1, "g": MOUTH_SPRITES.E1, "h": MOUTH_SPRITES.E1,
    "dZ": MOUTH_SPRITES.O1, "Z": MOUTH_SPRITES.O1, "k": MOUTH_SPRITES.E1, "@L": MOUTH_SPRITES.E2, "l": MOUTH_SPRITES.E1,
    "m": MOUTH_SPRITES.CL, "n": MOUTH_SPRITES.E1, "n-": MOUTH_SPRITES.E1, "N": MOUTH_SPRITES.E1,
    "p": MOUTH_SPRITES.CL, "r": MOUTH_SPRITES.O2, "r-": MOUTH_SPRITES.O2, "s": MOUTH_SPRITES.E1, "S": MOUTH_SPRITES.O2,
    "t": MOUTH_SPRITES.E1, "t#": MOUTH_SPRITES.E1, "t2": MOUTH_SPRITES.E1, "T": MOUTH_SPRITES.E1, "tS": MOUTH_SPRITES.O1,
    "D": MOUTH_SPRITES.E1, "v": MOUTH_SPRITES.E1, "w": MOUTH_SPRITES.O1, "j": MOUTH_SPRITES.E1, "z": MOUTH_SPRITES.E1,
    ";": -1, "_": MOUTH_SPRITES.CL, "_:": MOUTH_SPRITES.CL
};

{
    async function main() {
        let [
            phontab,
            phondata,
            phonindex,
            intonations,
            en_dict,
            en_US,
        ] = await Promise.all(espeakFetch([
            "phontab",
            "phondata",
            "phonindex",
            "intonations",
            "en_dict",
            "lang/gmw/en-US",
        ]));
        let speakNgBuffer = await fetch("/speak-ng.wasm").then((res) => res.arrayBuffer());
        let { WASI } = await import("/lib/runno.js");
        async function play(text, options = {}) {
            let stdoutLines = [];
            let stdoutBuf = "";

            let wasi = new WASI({
                args: [
                    "speak-ng",
                    "-w", "/wav.wav",
                    "--pho",
                    "-v", "en-us",
                    "-p", String(options.pitch || 50),
                    "-s", String(options.speed || 175),
                    "--path=/espeak",
                    "--",
                    text,
                ],
                stdout: (char) => {
                    if (char === "\n") {
                        if (stdoutBuf.trim()) stdoutLines.push(stdoutBuf.trim());
                        stdoutBuf = "";
                    } else {
                        stdoutBuf += char;
                    }
                },
                stderr: console.error,
                fs: {
                    "/espeak/phontab": {
                        path: "/espeak/phontab",
                        ...timestamps(),
                        mode: "binary",
                        content: phontab,
                    },
                    "/espeak/phondata": {
                        path: "/espeak/phondata",
                        ...timestamps(),
                        mode: "binary",
                        content: phondata,
                    },
                    "/espeak/phonindex": {
                        path: "/espeak/phonindex",
                        ...timestamps(),
                        mode: "binary",
                        content: phonindex,
                    },
                    "/espeak/intonations": {
                        path: "/espeak/intonations",
                        ...timestamps(),
                        mode: "binary",
                        content: intonations,
                    },
                    "/espeak/en_dict": {
                        path: "/espeak/en_dict",
                        ...timestamps(),
                        mode: "binary",
                        content: en_dict,
                    },
                    "/espeak/lang/gmw/en-US": {
                        path: "/espeak/lang/gmw/en-US",
                        ...timestamps(),
                        mode: "binary",
                        content: en_US,
                    },
                },
            });
            let wasm = await WebAssembly.instantiate(speakNgBuffer, {
                ...wasi.getImportObject(),
            });
            await wasi.start(wasm);
            if (stdoutBuf.trim()) stdoutLines.push(stdoutBuf.trim());

            // --pho output: "sampleOffset\tphoneme" at 22050 Hz
            const SAMPLE_RATE = 22050;
            let lipTimings = stdoutLines.map((line) => {
                let parts = line.split(/\s+/);
                let sampleOffset = parseInt(parts[0], 10);
                let phoneme = parts[1] || "_";
                let ms = Math.round(sampleOffset / SAMPLE_RATE * 1000);
                let sprite = PHONEME_TO_MOUTH[phoneme] ?? MOUTH_SPRITES.CL;
                return [ms, sprite];
            }).filter(([ms]) => !isNaN(ms));

            let wav = wasi.drive.fs["/wav.wav"].content;
            return { wav, lipTimings };
        }
        createWav = play;
    }
    main().then(() => {
        resolveReady();
    });
}

function espeakFetch(arr) {
    return arr.map((url) => {
        return fetch(`/espeak-ng-data/${url}`)
            .then(data => data.arrayBuffer())
            .then(data => new Uint8Array(data));
    });
}

onmessage = async (e) => {
    await ready;
    let { id, text, options } = e.data;
    let { wav, lipTimings } = await createWav(text, options);
    postMessage({ id, wav, lipTimings }, [wav.buffer]);
};
