/**
 * Copyright(c) Live2D Inc. All rights reserved.
 *
 * Use of this source code is governed by the Live2D Open Software license
 * that can be found at https://www.live2d.com/eula/live2d-open-software-license-agreement_en.html.
 */

/** @deprecated この変数は getInstance() が非推奨になったことに伴い、非推奨となりました。 */
export let s_instance: LAppWavFileHandler = null;

export class LAppWavFileHandler {
  /**
   * クラスのインスタンス（シングルトン）を返す。
   * インスタンスが生成されていない場合は内部でインスタンスを生成する。
   *
   * @return クラスのインスタンス
   * @deprecated このクラスでのシングルトンパターンの使用は非推奨となりました。代わりに new LAppWavFileHandler() を使用してください。
   */
  public static getInstance(): LAppWavFileHandler {
    if (s_instance == null) {
      s_instance = new LAppWavFileHandler();
    }

    return s_instance;
  }

  /**
   * クラスのインスタンス（シングルトン）を解放する。
   *
   * @deprecated この関数は getInstance() が非推奨になったことに伴い、非推奨となりました。
   */
  public static releaseInstance(): void {
    if (s_instance != null) {
      s_instance = void 0;
    }

    s_instance = null;
  }

  public update(deltaTimeSeconds: number) {
    let goalOffset: number;
    let rms: number;

    // データロード前/ファイル末尾に達した場合は更新しない
    if (
      this._pcmData == null ||
      this._sampleOffset >= this._wavFileInfo._samplesPerChannel
    ) {
      this._lastRms = 0.0;
      return false;
    }

    // 経過時間後の状態を保持
    this._userTimeSeconds += deltaTimeSeconds;
    goalOffset = Math.floor(
      this._userTimeSeconds * this._wavFileInfo._samplingRate
    );
    if (goalOffset > this._wavFileInfo._samplesPerChannel) {
      goalOffset = this._wavFileInfo._samplesPerChannel;
    }

    const framesAdvanced = goalOffset - this._sampleOffset;
    if (framesAdvanced <= 0 || this._wavFileInfo._numberOfChannels <= 0) {
      return true;
    }

    // RMS計測
    rms = 0.0;
    for (
      let channelCount = 0;
      channelCount < this._wavFileInfo._numberOfChannels;
      channelCount++
    ) {
      for (
        let sampleCount = this._sampleOffset;
        sampleCount < goalOffset;
        sampleCount++
      ) {
        const pcm = this._pcmData[channelCount][sampleCount];
        rms += pcm * pcm;
      }
    }
    rms = Math.sqrt(
      rms /
        (this._wavFileInfo._numberOfChannels * framesAdvanced)
    );

    this._lastRms = rms;
    this._sampleOffset = goalOffset;
    if (this._debugLogFrames > 0) {
      console.debug('LAppWavFileHandler.update RMS', {
        rms,
        framesAdvanced,
        sampleOffset: this._sampleOffset,
        samplesPerChannel: this._wavFileInfo._samplesPerChannel,
      });
      this._debugLogFrames--;
    }
    return true;
  }

  private resetForNewFile(): void {
    this._sampleOffset = 0;
    this._userTimeSeconds = 0.0;
    this._lastRms = 0.0;
    this._debugLogFrames = 6;

    if (this._pcmData != null) {
      this.releasePcmData();
    }

    this._wavFileInfo._fileName = '';
    this._wavFileInfo._bitsPerSample = 0;
    this._wavFileInfo._numberOfChannels = 0;
    this._wavFileInfo._samplingRate = 0;
    this._wavFileInfo._samplesPerChannel = 0;

    this._byteReader._fileByte = undefined;
    this._byteReader._fileDataView = undefined;
    this._byteReader._fileSize = 0;
    this._byteReader._readOffset = 0;
  }

  private decodeCurrentFile(): boolean {
    try {
      if (
        this._byteReader == null ||
        this._byteReader._fileDataView == null ||
        this._byteReader._fileSize < 4
      ) {
        return false;
      }

      const reader = this._byteReader;
      const info = this._wavFileInfo;
      reader._readOffset = 0;

      if (!reader.getCheckSignature('RIFF')) {
        throw new Error('Cannot find Signeture "RIFF".');
      }
      reader.get32LittleEndian();
      if (!reader.getCheckSignature('WAVE')) {
        throw new Error('Cannot find Signeture "WAVE".');
      }
      if (!reader.getCheckSignature('fmt ')) {
        throw new Error('Cannot find Signeture "fmt".');
      }

      const fmtChunkSize = reader.get32LittleEndian();
      if (reader.get16LittleEndian() != 1) {
        throw new Error('File is not linear PCM.');
      }

      info._numberOfChannels = reader.get16LittleEndian();
      info._samplingRate = reader.get32LittleEndian();
      reader.get32LittleEndian();
      reader.get16LittleEndian();
      info._bitsPerSample = reader.get16LittleEndian();

      if (fmtChunkSize > 16) {
        reader._readOffset += fmtChunkSize - 16;
      }

      while (!reader.getCheckSignature('data') && reader._readOffset < reader._fileSize) {
        reader._readOffset += reader.get32LittleEndian() + 4;
      }

      if (reader._readOffset >= reader._fileSize) {
        throw new Error('Cannot find "data" Chunk.');
      }

      const dataChunkSize = reader.get32LittleEndian();
      info._samplesPerChannel =
        (dataChunkSize * 8) / (info._bitsPerSample * info._numberOfChannels);

      this._pcmData = new Array(info._numberOfChannels);
      for (let channel = 0; channel < info._numberOfChannels; channel++) {
        this._pcmData[channel] = new Float32Array(info._samplesPerChannel);
      }

      for (let sample = 0; sample < info._samplesPerChannel; sample++) {
        for (let channel = 0; channel < info._numberOfChannels; channel++) {
          this._pcmData[channel][sample] = this.getPcmSample();
        }
      }

      if (this._debugLogFrames > 0) {
        console.debug('LAppWavFileHandler.decodeCurrentFile success', {
          channels: info._numberOfChannels,
          sampleRate: info._samplingRate,
          bitsPerSample: info._bitsPerSample,
          samplesPerChannel: info._samplesPerChannel,
        });
      }

      return true;
    } catch (error) {
      console.error('LAppWavFileHandler.decodeCurrentFile - Failed to decode WAV data.', error);
      if (this._pcmData != null) {
        this.releasePcmData();
      }
      return false;
    }
  }

  public start(filePath: string): void {
    void this.loadWavFile(filePath);
  }

  public getRms(): number {
    return this._lastRms;
  }

  public async loadWavFile(filePath: string): Promise<boolean> {
    this.resetForNewFile();

    try {
      const response = await fetch(filePath);
      const fileBytes = await response.arrayBuffer();

      if (!fileBytes || fileBytes.byteLength < 4) {
        console.warn('LAppWavFileHandler.loadWavFile - Empty WAV response.', filePath);
        return false;
      }

      this.loadFiletoBytes(fileBytes, fileBytes.byteLength);
      this._wavFileInfo._fileName = filePath;

      return this.decodeCurrentFile();
    } catch (error) {
      console.error('LAppWavFileHandler.loadWavFile - Failed to fetch WAV file.', error);
      return false;
    }
  }

  public startFromArrayBuffer(arrayBuffer: ArrayBuffer): boolean {
    this.resetForNewFile();

    this.loadFiletoBytes(arrayBuffer, arrayBuffer.byteLength);
    this._byteReader._readOffset = 0;
    this._wavFileInfo._fileName = 'inline.wav';

    return this.decodeCurrentFile();
  }

  public getPcmSample(): number {
    let pcm32;

    // 32ビット幅に拡張してから-1～1の範囲に丸める
    switch (this._wavFileInfo._bitsPerSample) {
      case 8:
        pcm32 = this._byteReader.get8() - 128;
        pcm32 <<= 24;
        break;
      case 16:
        pcm32 = this._byteReader.get16LittleEndian() << 16;
        break;
      case 24:
        pcm32 = this._byteReader.get24LittleEndian() << 8;
        break;
      default:
        // 対応していないビット幅
        pcm32 = 0;
        break;
    }

    return pcm32 / 2147483647; //Number.MAX_VALUE;
  }

  /**
   * 指定したチャンネルから音声サンプルの配列を取得する
   *
   * @param usechannel 利用するチャンネル
   * @returns 指定したチャンネルの音声サンプルの配列
   */
  public getPcmDataChannel(usechannel: number): Float32Array | null {
    // 指定したチャンネル数がデータ用配列の長さより多いならnullを返す。
    if (!this._pcmData || !(usechannel < this._pcmData.length)) {
      return null;
    }

    // _pcmDataから新規に指定したチャンネルのFloat32Arrayを作成する。
    return Float32Array.from(this._pcmData[usechannel]);
  }

  /**
   * 音声のサンプリング周波数を取得する。
   *
   * @returns 音声のサンプリング周波数
   */
  public getWavSamplingRate(): number | null {
    if (!this._wavFileInfo || this._wavFileInfo._samplingRate < 1) {
      return null;
    }

    return this._wavFileInfo._samplingRate;
  }

  public releasePcmData(): void {
    this._pcmData = null;
  }

  constructor() {
    this._pcmData = null;
    this._userTimeSeconds = 0.0;
    this._lastRms = 0.0;
    this._sampleOffset = 0.0;
    this._wavFileInfo = new WavFileInfo();
    this._byteReader = new ByteReader();
    this._debugLogFrames = 0;
  }

  _pcmData: Array<Float32Array> | null;
  _userTimeSeconds: number;
  _lastRms: number;
  _sampleOffset: number;
  _wavFileInfo: WavFileInfo;
  _byteReader: ByteReader;
  private _debugLogFrames: number;
  loadFiletoBytes = (arrayBuffer: ArrayBuffer, length: number): void => {
    this._byteReader._fileByte = arrayBuffer;
    this._byteReader._fileDataView = new DataView(arrayBuffer);
    this._byteReader._fileSize = length;
    this._byteReader._readOffset = 0;
  };
}

export class WavFileInfo {
  constructor() {
    this._fileName = '';
    this._numberOfChannels = 0;
    this._bitsPerSample = 0;
    this._samplingRate = 0;
    this._samplesPerChannel = 0;
  }

  _fileName: string; ///< ファイル名
  _numberOfChannels: number; ///< チャンネル数
  _bitsPerSample: number; ///< サンプルあたりビット数
  _samplingRate: number; ///< サンプリングレート
  _samplesPerChannel: number; ///< 1チャンネルあたり総サンプル数
}

export class ByteReader {
  constructor() {
    this._fileByte = undefined;
    this._fileDataView = undefined;
    this._fileSize = 0;
    this._readOffset = 0;
  }

  /**
   * @brief 8ビット読み込み
   * @return Csm::csmUint8 読み取った8ビット値
   */
  public get8(): number {
    const view = this._fileDataView;
    if (!view) {
      throw new Error('ByteReader.get8 called before data was loaded.');
    }
    const ret = view.getUint8(this._readOffset);
    this._readOffset++;
    return ret;
  }

  /**
   * @brief 16ビット読み込み（リトルエンディアン）
   * @return Csm::csmUint16 読み取った16ビット値
   */
  public get16LittleEndian(): number {
    const view = this._fileDataView;
    if (!view) {
      throw new Error('ByteReader.get16LittleEndian called before data was loaded.');
    }
    const ret =
      (view.getUint8(this._readOffset + 1) << 8) |
      view.getUint8(this._readOffset);
    this._readOffset += 2;
    return ret;
  }

  /**
   * @brief 24ビット読み込み（リトルエンディアン）
   * @return Csm::csmUint32 読み取った24ビット値（下位24ビットに設定）
   */
  public get24LittleEndian(): number {
    const view = this._fileDataView;
    if (!view) {
      throw new Error('ByteReader.get24LittleEndian called before data was loaded.');
    }
    const ret =
      (view.getUint8(this._readOffset + 2) << 16) |
      (view.getUint8(this._readOffset + 1) << 8) |
      view.getUint8(this._readOffset);
    this._readOffset += 3;
    return ret;
  }

  /**
   * @brief 32ビット読み込み（リトルエンディアン）
   * @return Csm::csmUint32 読み取った32ビット値
   */
  public get32LittleEndian(): number {
    const view = this._fileDataView;
    if (!view) {
      throw new Error('ByteReader.get32LittleEndian called before data was loaded.');
    }
    const ret =
      (view.getUint8(this._readOffset + 3) << 24) |
      (view.getUint8(this._readOffset + 2) << 16) |
      (view.getUint8(this._readOffset + 1) << 8) |
      view.getUint8(this._readOffset);
    this._readOffset += 4;
    return ret;
  }

  /**
   * @brief シグネチャの取得と参照文字列との一致チェック
   * @param[in] reference 検査対象のシグネチャ文字列
   * @retval  true    一致している
   * @retval  false   一致していない
   */
  public getCheckSignature(reference: string): boolean {
    const getSignature: Uint8Array = new Uint8Array(4);
    const referenceString: Uint8Array = new TextEncoder().encode(reference);
    if (reference.length != 4) {
      return false;
    }
    for (let signatureOffset = 0; signatureOffset < 4; signatureOffset++) {
      getSignature[signatureOffset] = this.get8();
    }
    return (
      getSignature[0] == referenceString[0] &&
      getSignature[1] == referenceString[1] &&
      getSignature[2] == referenceString[2] &&
      getSignature[3] == referenceString[3]
    );
  }

  _fileByte: ArrayBuffer | undefined; ///< ロードしたファイルのバイト列
  _fileDataView: DataView | undefined;
  _fileSize: number; ///< ファイルサイズ
  _readOffset: number; ///< ファイル参照位置
}
