let taskId = 0;
let tasks = new Map();

let ttsWorker = new Worker("./espeakWorker.js", { type: "module" });
let audioCtx = new AudioContext();
let gainNode = new GainNode(audioCtx, { gain: 1 });
gainNode.connect(audioCtx.destination);

export function setVolume(vol) {
    if (vol === 0) {
        gainNode.gain.value = 0;
    } else {
        gainNode.gain.value = 10 ** ((25 * vol + -25) / 20);
    }
}

function generateLipSync(buffer) {
    let channelData = buffer.getChannelData(0);
    let sampleRate = buffer.sampleRate;
    let intervalSamples = Math.floor(sampleRate * 0.01); // 10ms buckets
    let lipTimings = [[0, "_"]];

    for (let i = 0; i < channelData.length; i += intervalSamples) {
        let count = Math.min(intervalSamples, channelData.length - i);
        let sum = 0;
        for (let j = i; j < i + count; j++) {
            sum += channelData[j] * channelData[j];
        }
        let rms = Math.sqrt(sum / count);
        let ms = Math.floor(i / sampleRate * 1000);

        let phoneme;
        if (rms < 0.008) phoneme = "_";
        else if (rms < 0.04)  phoneme = "E";
        else if (rms < 0.10)  phoneme = "I";
        else                   phoneme = "a";

        lipTimings.push([ms, phoneme]);
    }
    return lipTimings;
}

function play(text, options = {}, onend = () => {}, onstart = () => {}, signal = { aborted: false }) {
    let id = taskId++;
    text = text.replace(/(.{5,}?)\1{5,}/gi, "$1$1$1$1$1");
    tasks.set(id, { onstart, onend, signal });
    ttsWorker.postMessage({ id, text, options });
}

export let speak = {
    play,
};

ttsWorker.addEventListener("message", async (e) => {
    let { id, wav } = e.data;
    let task = tasks.get(id);
    if (task.signal.aborted) {
        tasks.delete(id);
        return;
    }
    let buffer = await audioCtx.decodeAudioData(wav.buffer);
    let lipTimings = generateLipSync(buffer);
    let source = audioCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(gainNode);
    if (audioCtx.state === "suspended") await audioCtx.resume();
    source.start();
    task.onstart(source, lipTimings);
    source.addEventListener("ended", () => {
        task.onend();
        tasks.delete(id);
    });
});
