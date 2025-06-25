import fs from 'fs/promises';
import path from 'path';
import { Readable } from 'stream';
import { nodewhisper } from 'nodejs-whisper';
import ffmpeg from 'fluent-ffmpeg';
import Utils from '../utils/index.js';
import { CONFIG, __dirname } from '../config/index.js';
import JobQueue from './jobQueue.js';

/**
 * Serviço otimizado para transcrição de áudio usando Whisper
 * Corrige problemas de sintaxe e simplifica a lógica
 */
class AudioTranscriber {
  constructor() {
    this.queue = new JobQueue(
      CONFIG.queues.whisperConcurrency,
      CONFIG.queues.memoryThresholdGB
    );
  }

  /**
   * Determina o formato de áudio baseado no MIME type
   */
  #formatFromMime(mime) {
    if (!mime) return null;
    
    const formatMap = {
      'ogg': 'ogg',
      'wav': 'wav', 
      'mpeg': 'mp3',
      'mp4': 'mp4'
    };
    
    for (const [key, value] of Object.entries(formatMap)) {
      if (mime.includes(key)) return value;
    }
    
    return null;
  }

  /**
   * Converte áudio para formato WAV usando FFmpeg
   */
  async #convertToWav(audioBuffer, mimeType, outputPath) {
    return new Promise((resolve, reject) => {
      const inputStream = Readable.from(audioBuffer);
      let command = ffmpeg(inputStream);
      
      const format = this.#formatFromMime(mimeType);
      if (format) {
        command = command.inputFormat(format);
      }
      
      // Timeout para conversão de áudio
      const timeout = setTimeout(() => {
        command.kill('SIGKILL');
        reject(new Error('Timeout na conversão de áudio'));
      }, CONFIG.audio.timeout || 30000);
      
      command
        .outputOptions(`-ar ${CONFIG.audio.sampleRate}`)
        .toFormat('wav')
        .on('error', (err) => {
          clearTimeout(timeout);
          console.error('Erro no FFMPEG:', err);
          reject(err);
        })
        .on('end', () => {
          clearTimeout(timeout);
          resolve();
        })
        .save(outputPath);
    });
  }

  /**
   * Executa a transcrição usando Whisper
   */
  async #executeWhisper(audioPath) {
    const options = {
      modelName: CONFIG.audio.model,
      autoDownloadModelName: CONFIG.audio.model,
      verbose: false, // Reduzir logs desnecessários
      removeWavFileAfterTranscription: false,
      withCuda: false,
      whisperOptions: { 
        outputInText: true, 
        language: CONFIG.audio.language 
      }
    };
    
    // Timeout para Whisper
    const whisperPromise = nodewhisper(audioPath, options);
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Timeout na transcrição Whisper')), 
        CONFIG.audio.whisperTimeout || 60000)
    );
    
    await Promise.race([whisperPromise, timeoutPromise]);
    
    const transcriptionPath = `${audioPath}.txt`;
    const transcription = await fs.readFile(transcriptionPath, 'utf8');
    
    return { transcription: transcription.trim(), transcriptionPath };
  }

  /**
   * Limpa arquivos temporários
   */
  async #cleanup(files) {
    for (const file of files) {
      try {
        await Utils.cleanupFile(file);
      } catch (err) {
        console.warn(`Aviso: Não foi possível limpar arquivo ${file}:`, err.message);
      }
    }
  }

  /**
   * Transcreve áudio para texto
   * @param {Buffer} audioBuffer - Buffer do áudio
   * @param {string} mimeType - Tipo MIME do áudio
   * @returns {Promise<string>} - Texto transcrito
   */
  async transcribe(audioBuffer, mimeType = null) {
    return this.queue.add(async () => {
      console.log('🎤 Iniciando transcrição de áudio...');
      
      const timestamp = Date.now();
      const tempOutputPath = path.join(__dirname, `audio_${timestamp}.wav`);
      let transcriptionPath = null;
      
      try {
        // Converter áudio para WAV
        await this.#convertToWav(audioBuffer, mimeType, tempOutputPath);
        
        // Executar transcrição
        const result = await this.#executeWhisper(tempOutputPath);
        transcriptionPath = result.transcriptionPath;
        
        console.log('✅ Transcrição concluída.');
        return result.transcription;
        
      } catch (err) {
        console.error('❌ Erro na transcrição de áudio:', err);
        throw new Error(`Falha na transcrição: ${err.message}`);
        
      } finally {
        // Limpar arquivos temporários
        const filesToClean = [tempOutputPath];
        if (transcriptionPath) filesToClean.push(transcriptionPath);
        await this.#cleanup(filesToClean);
      }
    });
  }

  /**
   * Verifica se o serviço está funcionando
   */
  async healthCheck() {
    try {
      // Teste simples com buffer vazio
      const testBuffer = Buffer.alloc(1024);
      await this.transcribe(testBuffer, 'audio/wav');
      return { status: 'ok', service: 'AudioTranscriber' };
    } catch (err) {
      return { status: 'error', service: 'AudioTranscriber', error: err.message };
    }
  }
}

export default AudioTranscriber;

