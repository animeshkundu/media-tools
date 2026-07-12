declare module 'lamejs' {
  const lamejs: {
    Mp3Encoder: new (
      channels: number,
      sampleRate: number,
      bitrateKbps: number,
    ) => {
      encodeBuffer(left: Int16Array, right?: Int16Array): Int8Array;
      flush(): Int8Array;
    };
  };

  export default lamejs;
}

declare module 'lamejs/src/js/Lame.js' {
  const Lame: unknown;
  export default Lame;
}

declare module 'lamejs/src/js/BitStream.js' {
  const BitStream: unknown;
  export default BitStream;
}

declare module 'lamejs/src/js/MPEGMode.js' {
  const MPEGMode: unknown;
  export default MPEGMode;
}
