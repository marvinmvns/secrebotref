import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import YTDlpWrapPkg from 'yt-dlp-wrap';
const { default: YTDlpWrap } = YTDlpWrapPkg;
import AudioTranscriber from '../audioTranscriber.js';
import LLMService from '../llmService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Processador de vídeo otimizado e simplificado
 * Remove dependências desnecessárias e usa LLM para resumos
 */
export default class VideoProcessor {
  constructor(options = {}) {
    this.ytdlpPath = options.ytdlpPath || 'yt-dlp';
    this.ytdlp = new YTDlpWrap(this.ytdlpPath);
    this.tempDir = options.tempDir || path.join(__dirname, '../../temp');
    this.transcriber = options.transcriber || new AudioTranscriber();
    this.llmService = options.llmService || new LLMService();
    
    this.defaultOptions = {
      languages: ['pt', 'en'],
      subtitleFormat: 'srt',
      timeout: 300000, // 5 minutos
      maxFileSizeMB: 500,
      preferManualSubs: true,
      audioTimeout: 120000 // 2 minutos para extração de áudio
    };
  }

  /**
   * Processa vídeo completo: extrai texto e gera resumo
   */
  async processVideo(url, options = {}) {
    const config = { ...this.defaultOptions, ...options };
    
    try {
      await this.ensureTempDir();
      
      console.log('📹 Iniciando processamento de vídeo...');
      
      // Obter metadados do vídeo
      const metadata = await this.getVideoMetadata(url);
      console.log(`📊 Vídeo: ${metadata.title} (${metadata.duration}s)`);
      
      // Tentar extrair legendas primeiro
      let text = await this.extractSubtitles(url, config);
      let source = 'subtitles';
      
      // Se não houver legendas, usar Whisper
      if (!text || text.length < 100) {
        console.log('🎤 Legendas não encontradas, usando transcrição...');
        text = await this.transcribeWithWhisper(url, config);
        source = 'whisper';
      }
      
      // Limpar e validar texto
      text = this.cleanText(text);
      if (!text || text.length < 50) {
        throw new Error('Não foi possível extrair texto suficiente do vídeo');
      }
      
      // Gerar resumo usando LLM
      console.log('🤖 Gerando resumo...');
      const summary = await this.generateSummaryWithLLM(text);
      
      console.log('✅ Processamento de vídeo concluído');
      
      return {
        metadata: {
          title: metadata.title,
          duration: metadata.duration,
          url,
          subtitleSource: source
        },
        transcription: text,
        summary
      };
      
    } catch (err) {
      console.error('❌ Erro no processamento de vídeo:', err);
      throw new Error(`Falha no processamento: ${err.message}`);
    }
  }

  /**
   * Apenas transcreve o vídeo sem gerar resumo
   */
  async transcribeVideo(url, options = {}) {
    const config = { ...this.defaultOptions, ...options };
    
    try {
      await this.ensureTempDir();
      const metadata = await this.getVideoMetadata(url);
      
      // Tentar legendas primeiro, depois Whisper
      let text = await this.extractSubtitles(url, config);
      if (!text || text.length < 100) {
        text = await this.transcribeWithWhisper(url, config);
      }
      
      return {
        metadata: {
          title: metadata.title,
          duration: metadata.duration,
          url
        },
        transcription: this.cleanText(text)
      };
      
    } catch (err) {
      console.error('❌ Erro na transcrição:', err);
      throw new Error(`Falha na transcrição: ${err.message}`);
    }
  }

  /**
   * Garante que o diretório temporário existe
   */
  async ensureTempDir() {
    try {
      await fs.mkdir(this.tempDir, { recursive: true });
    } catch (err) {
      console.warn('Aviso ao criar diretório temp:', err.message);
    }
  }

  /**
   * Obtém metadados do vídeo
   */
  async getVideoMetadata(url) {
    try {
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Timeout ao obter metadados')), 30000)
      );
      
      const info = await Promise.race([
        this.ytdlp.getVideoInfo(url),
        timeoutPromise
      ]);
      
      return {
        title: info.title || 'Vídeo sem título',
        duration: info.duration || 0,
        filesize: info.filesize || 0
      };
      
    } catch (err) {
      console.warn('Erro ao obter metadados:', err.message);
      return {
        title: 'Vídeo',
        duration: 0,
        filesize: 0
      };
    }
  }

  /**
   * Extrai legendas do vídeo
   */
  async extractSubtitles(url, config) {
    const outFile = path.join(this.tempDir, `subs_${Date.now()}.%(ext)s`);
    
    const args = [
      url,
      '--skip-download',
      '--write-subs',
      '--sub-langs', config.languages.join(','),
      '--sub-format', config.subtitleFormat,
      '-o', outFile
    ];
    
    if (!config.preferManualSubs) {
      args.push('--write-auto-subs');
    }
    
    try {
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Timeout na extração de legendas')), config.timeout)
      );
      
      await Promise.race([
        this.ytdlp.execPromise(args),
        timeoutPromise
      ]);
      
      // Procurar arquivo de legenda
      const files = await fs.readdir(this.tempDir);
      const subFile = files.find(f => 
        f.includes('subs_') && (f.endsWith('.srt') || f.endsWith('.vtt'))
      );
      
      if (!subFile) {
        console.log('📝 Nenhuma legenda encontrada');
        return null;
      }
      
      const content = await fs.readFile(path.join(this.tempDir, subFile), 'utf8');
      
      // Limpar arquivo temporário
      await fs.unlink(path.join(this.tempDir, subFile)).catch(() => {});
      
      console.log('📝 Legendas extraídas com sucesso');
      return content;
      
    } catch (err) {
      console.log('📝 Falha na extração de legendas:', err.message);
      return null;
    }
  }

  /**
   * Transcreve áudio do vídeo usando Whisper
   */
  async transcribeWithWhisper(url, config) {
    const audioPath = path.join(this.tempDir, `audio_${Date.now()}.wav`);
    
    try {
      console.log('🎵 Extraindo áudio...');
      
      const extractPromise = this.ytdlp.execPromise([
        url,
        '--extract-audio',
        '--audio-format', 'wav',
        '--audio-quality', '0',
        '--postprocessor-args', '-ar 16000 -ac 1',
        '-o', audioPath
      ]);
      
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Timeout na extração de áudio')), config.audioTimeout)
      );
      
      await Promise.race([extractPromise, timeoutPromise]);
      
      // Verificar se o arquivo foi criado
      const stats = await fs.stat(audioPath);
      if (stats.size === 0) {
        throw new Error('Arquivo de áudio vazio');
      }
      
      console.log('🎵 Áudio extraído, iniciando transcrição...');
      
      // Ler áudio e transcrever
      const audioBuffer = await fs.readFile(audioPath);
      const text = await this.transcriber.transcribe(audioBuffer, 'audio/wav');
      
      return text;
      
    } catch (err) {
      console.error('🎵 Erro na transcrição com Whisper:', err);
      throw err;
      
    } finally {
      // Limpar arquivo de áudio
      try {
        await fs.unlink(audioPath);
      } catch (cleanupErr) {
        console.warn('Aviso: Não foi possível limpar arquivo de áudio:', cleanupErr.message);
      }
    }
  }

  /**
   * Gera resumo usando LLM em vez de bibliotecas externas
   */
  async generateSummaryWithLLM(text) {
    try {
      const prompt = `Por favor, faça um resumo conciso e informativo do seguinte texto de vídeo:

${text}

Resumo:`;

      const summary = await this.llmService.getAssistantResponse('video_processor', prompt);
      return summary;
      
    } catch (err) {
      console.error('🤖 Erro ao gerar resumo com LLM:', err);
      
      // Fallback: resumo simples baseado em parágrafos
      const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 20);
      const summaryLength = Math.min(3, Math.ceil(sentences.length * 0.1));
      return sentences.slice(0, summaryLength).join('. ') + '.';
    }
  }

  /**
   * Limpa e normaliza texto
   */
  cleanText(text) {
    if (!text) return '';
    
    return text
      .replace(/\[.*?\]/g, '') // Remove timestamps e anotações
      .replace(/\n+/g, ' ') // Substitui quebras de linha por espaços
      .replace(/\s+/g, ' ') // Remove espaços múltiplos
      .replace(/[^\w\s\.,!?;:-]/g, '') // Remove caracteres especiais
      .trim();
  }

  /**
   * Verifica se o serviço está funcionando
   */
  async healthCheck() {
    try {
      // Teste com URL de exemplo
      const testUrl = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
      const metadata = await this.getVideoMetadata(testUrl);
      
      return { 
        status: 'ok', 
        service: 'VideoProcessor',
        ytdlpPath: this.ytdlpPath,
        tempDir: this.tempDir
      };
    } catch (err) {
      return { 
        status: 'error', 
        service: 'VideoProcessor', 
        error: err.message 
      };
    }
  }

  /**
   * Limpa arquivos temporários antigos
   */
  async cleanupTempFiles() {
    try {
      const files = await fs.readdir(this.tempDir);
      const now = Date.now();
      const maxAge = 3600000; // 1 hora
      
      for (const file of files) {
        const filePath = path.join(this.tempDir, file);
        const stats = await fs.stat(filePath);
        
        if (now - stats.mtime.getTime() > maxAge) {
          await fs.unlink(filePath);
          console.log(`🧹 Arquivo temporário removido: ${file}`);
        }
      }
    } catch (err) {
      console.warn('Aviso na limpeza de arquivos temporários:', err.message);
    }
  }
}

