import AudioTranscriber from './audioTranscriber.js';
import LLMService from './llmService.js';
import VideoProcessor from './video/VideoProcessor.js';
import { CONFIG } from '../config/index.js';

/**
 * Serviço unificado que integra todos os serviços de IA
 * Fornece uma interface simples e consistente
 */
class UnifiedAIService {
  constructor(options = {}) {
    this.audioTranscriber = new AudioTranscriber();
    this.llmService = new LLMService();
    this.videoProcessor = new VideoProcessor({
      transcriber: this.audioTranscriber,
      llmService: this.llmService,
      ...options
    });
    
    this.isInitialized = false;
  }

  /**
   * Inicializa todos os serviços
   */
  async initialize() {
    try {
      console.log('🚀 Inicializando serviços de IA...');
      
      // Verificar saúde de todos os serviços
      const healthChecks = await Promise.allSettled([
        this.audioTranscriber.healthCheck(),
        this.llmService.healthCheck(),
        this.videoProcessor.healthCheck()
      ]);
      
      const results = healthChecks.map((result, index) => {
        const services = ['AudioTranscriber', 'LLMService', 'VideoProcessor'];
        return {
          service: services[index],
          status: result.status === 'fulfilled' ? result.value.status : 'error',
          error: result.status === 'rejected' ? result.reason.message : null
        };
      });
      
      // Log dos resultados
      results.forEach(result => {
        if (result.status === 'ok') {
          console.log(`✅ ${result.service}: OK`);
        } else {
          console.warn(`⚠️ ${result.service}: ${result.error || 'Erro desconhecido'}`);
        }
      });
      
      this.isInitialized = true;
      console.log('🚀 Serviços de IA inicializados');
      
      return results;
      
    } catch (err) {
      console.error('❌ Erro na inicialização dos serviços:', err);
      throw err;
    }
  }

  /**
   * Transcreve áudio para texto
   */
  async transcribeAudio(audioBuffer, mimeType = null) {
    this.ensureInitialized();
    
    try {
      return await this.audioTranscriber.transcribe(audioBuffer, mimeType);
    } catch (err) {
      console.error('❌ Erro na transcrição de áudio:', err);
      throw new Error(`Falha na transcrição: ${err.message}`);
    }
  }

  /**
   * Processa vídeo completo (transcrição + resumo)
   */
  async processVideo(url, options = {}) {
    this.ensureInitialized();
    
    try {
      return await this.videoProcessor.processVideo(url, options);
    } catch (err) {
      console.error('❌ Erro no processamento de vídeo:', err);
      throw new Error(`Falha no processamento de vídeo: ${err.message}`);
    }
  }

  /**
   * Apenas transcreve vídeo
   */
  async transcribeVideo(url, options = {}) {
    this.ensureInitialized();
    
    try {
      return await this.videoProcessor.transcribeVideo(url, options);
    } catch (err) {
      console.error('❌ Erro na transcrição de vídeo:', err);
      throw new Error(`Falha na transcrição de vídeo: ${err.message}`);
    }
  }

  /**
   * Chat com assistente
   */
  async chatWithAssistant(contactId, message) {
    this.ensureInitialized();
    
    try {
      return await this.llmService.getAssistantResponse(contactId, message);
    } catch (err) {
      console.error('❌ Erro no chat com assistente:', err);
      throw new Error(`Falha no chat: ${err.message}`);
    }
  }

  /**
   * Chat com modo agenda
   */
  async chatWithAgenda(contactId, message) {
    this.ensureInitialized();
    
    try {
      return await this.llmService.getChatGPTResponse(contactId, message);
    } catch (err) {
      console.error('❌ Erro no chat com agenda:', err);
      throw new Error(`Falha no chat agenda: ${err.message}`);
    }
  }

  /**
   * Gera resumo de texto
   */
  async generateSummary(contactId, text) {
    this.ensureInitialized();
    
    try {
      return await this.llmService.getVideoSummary(contactId, text);
    } catch (err) {
      console.error('❌ Erro na geração de resumo:', err);
      throw new Error(`Falha na geração de resumo: ${err.message}`);
    }
  }

  /**
   * Processa perfil do LinkedIn
   */
  async processLinkedInProfile(contactId, url, liAt) {
    this.ensureInitialized();
    
    try {
      return await this.llmService.getAssistantResponseLinkedin(contactId, url, liAt);
    } catch (err) {
      console.error('❌ Erro no processamento LinkedIn:', err);
      throw new Error(`Falha no processamento LinkedIn: ${err.message}`);
    }
  }

  /**
   * Limpa contexto de um contato
   */
  clearContext(contactId, type = null) {
    if (type) {
      this.llmService.clearContext(contactId, type);
    } else {
      this.llmService.clearAllContexts(contactId);
    }
  }

  /**
   * Obtém estatísticas dos serviços
   */
  getStats() {
    return {
      initialized: this.isInitialized,
      llm: this.llmService.getStats(),
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Executa limpeza de arquivos temporários
   */
  async cleanup() {
    try {
      await this.videoProcessor.cleanupTempFiles();
      console.log('🧹 Limpeza de arquivos temporários concluída');
    } catch (err) {
      console.warn('⚠️ Erro na limpeza:', err.message);
    }
  }

  /**
   * Verifica se o serviço foi inicializado
   */
  ensureInitialized() {
    if (!this.isInitialized) {
      throw new Error('Serviço não inicializado. Chame initialize() primeiro.');
    }
  }

  /**
   * Verifica saúde de todos os serviços
   */
  async healthCheck() {
    try {
      const checks = await Promise.allSettled([
        this.audioTranscriber.healthCheck(),
        this.llmService.healthCheck(),
        this.videoProcessor.healthCheck()
      ]);
      
      const results = checks.map((check, index) => {
        const services = ['audio', 'llm', 'video'];
        return {
          service: services[index],
          status: check.status === 'fulfilled' ? check.value.status : 'error',
          details: check.status === 'fulfilled' ? check.value : { error: check.reason.message }
        };
      });
      
      const allHealthy = results.every(r => r.status === 'ok');
      
      return {
        status: allHealthy ? 'healthy' : 'degraded',
        services: results,
        initialized: this.isInitialized,
        timestamp: new Date().toISOString()
      };
      
    } catch (err) {
      return {
        status: 'error',
        error: err.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Desliga todos os serviços
   */
  async shutdown() {
    try {
      console.log('🛑 Desligando serviços...');
      
      // Limpar contextos
      this.llmService.contexts.clear();
      
      // Limpeza final
      await this.cleanup();
      
      this.isInitialized = false;
      console.log('🛑 Serviços desligados');
      
    } catch (err) {
      console.error('❌ Erro no desligamento:', err);
    }
  }
}

export default UnifiedAIService;

