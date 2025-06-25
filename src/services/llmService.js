import { Ollama } from 'ollama';
import Utils from '../utils/index.js';
import { CONFIG, CHAT_MODES, PROMPTS } from '../config/index.js';
import { fetchProfileRaw } from './linkedinScraper.js';
import JobQueue from './jobQueue.js';

/**
 * Serviço LLM otimizado com melhor gerenciamento de contexto e error handling
 */
class LLMService {
  constructor() {
    this.contexts = new Map();
    this.ollama = new Ollama({ host: CONFIG.llm.host });
    this.queue = new JobQueue(
      CONFIG.queues.llmConcurrency,
      CONFIG.queues.memoryThresholdGB
    );
    
    // Configurações de contexto
    this.maxContextSize = CONFIG.llm.maxContextSize || 10;
    this.contextCleanupInterval = CONFIG.llm.contextCleanupInterval || 3600000; // 1 hora
    
    // Limpeza automática de contextos antigos
    this.startContextCleanup();
  }

  /**
   * Inicia limpeza automática de contextos antigos
   */
  startContextCleanup() {
    setInterval(() => {
      this.cleanupOldContexts();
    }, this.contextCleanupInterval);
  }

  /**
   * Remove contextos antigos para economizar memória
   */
  cleanupOldContexts() {
    const now = Date.now();
    const maxAge = this.contextCleanupInterval * 2; // 2 horas
    
    for (const [key, context] of this.contexts.entries()) {
      if (context.lastUsed && (now - context.lastUsed) > maxAge) {
        this.contexts.delete(key);
        console.log(`🧹 Contexto removido: ${key}`);
      }
    }
  }

  /**
   * Obtém ou cria contexto para um contato e tipo
   */
  getContext(contactId, type) {
    const key = `${contactId}_${type}`;
    
    if (!this.contexts.has(key)) {
      this.contexts.set(key, {
        messages: [],
        lastUsed: Date.now(),
        created: Date.now()
      });
    }
    
    const context = this.contexts.get(key);
    context.lastUsed = Date.now();
    
    return context.messages;
  }

  /**
   * Limita o tamanho do contexto para evitar overflow
   */
  limitContext(messages) {
    if (messages.length <= this.maxContextSize) {
      return messages;
    }
    
    // Manter sempre a primeira mensagem (system) e as mais recentes
    const systemMessage = messages[0];
    const recentMessages = messages.slice(-this.maxContextSize + 1);
    
    return [systemMessage, ...recentMessages];
  }

  /**
   * Executa chat com o LLM
   */
  async chat(contactId, text, type, systemPrompt) {
    try {
      const context = this.getContext(contactId, type);
      context.push({ role: 'user', content: text });
      
      // Limitar contexto para evitar overflow
      const limitedContext = this.limitContext([...context]);
      const messages = [{ role: 'system', content: systemPrompt }, ...limitedContext];
      
      const response = await this.queue.add(async () => {
        // Timeout para requisições LLM
        const chatPromise = this.ollama.chat({
          model: CONFIG.llm.model,
          messages,
          options: {
            temperature: CONFIG.llm.temperature || 0.7,
            top_p: CONFIG.llm.top_p || 0.9
          }
        });
        
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Timeout na requisição LLM')), 
            CONFIG.llm.timeout || 30000)
        );
        
        return Promise.race([chatPromise, timeoutPromise]);
      });
      
      // Processar resposta baseado no tipo
      let content;
      if (type === CHAT_MODES.AGENDABOT) {
        try {
          content = Utils.extractJSON(response.message.content);
        } catch (err) {
          console.warn('Falha ao extrair JSON, usando texto bruto:', err.message);
          content = response.message.content;
        }
      } else {
        content = response.message.content;
      }
      
      context.push({ role: 'assistant', content });
      return content;
      
    } catch (err) {
      console.error(`❌ Erro no LLM (${type}):`, err);
      
      // Retornar mensagem de erro amigável baseada no tipo de erro
      if (err.message.includes('Timeout')) {
        throw new Error('O serviço está sobrecarregado. Tente novamente em alguns segundos.');
      } else if (err.message.includes('connection')) {
        throw new Error('Erro de conexão com o serviço LLM. Verifique a configuração.');
      } else {
        throw new Error(`Erro interno do LLM: ${err.message}`);
      }
    }
  }

  /**
   * Resposta para modo ChatGPT/Agenda
   */
  async getChatGPTResponse(contactId, text) {
    const date = Utils.getCurrentDateInGMTMinus3().toISOString();
    return this.chat(contactId, text, CHAT_MODES.AGENDABOT, PROMPTS.agenda(date));
  }

  /**
   * Resposta para modo Assistente
   */
  async getAssistantResponse(contactId, text) {
    const date = Utils.getCurrentDateInGMTMinus3().toISOString();
    return this.chat(contactId, text, CHAT_MODES.ASSISTANT, PROMPTS.assistant(date));
  }

  /**
   * Resumo de vídeo usando LLM
   */
  async getVideoSummary(contactId, text) {
    const date = Utils.getCurrentDateInGMTMinus3().toISOString();
    return this.chat(contactId, text, CHAT_MODES.ASSISTANT, PROMPTS.videoSummary(date));
  }

  /**
   * Resposta para LinkedIn com scraping
   */
  async getAssistantResponseLinkedin(contactId, url, liAt) {
    try {
      const data = await Promise.race([
        fetchProfileRaw(url, {
          liAt,
          timeoutMs: CONFIG.linkedin.timeoutMs
        }),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Timeout no LinkedIn scraping')), 
            CONFIG.linkedin.timeoutMs + 5000)
        )
      ]);
      
      const text = data.success ? data.rawText : data.error;
      return await this.chat(contactId, text, CHAT_MODES.LINKEDIN, PROMPTS.linkedin);
      
    } catch (err) {
      console.error('❌ Erro ao processar LinkedIn:', err);
      return 'Desculpe, não foi possível processar o perfil do LinkedIn no momento. Tente novamente mais tarde.';
    }
  }

  /**
   * Limpa contexto específico
   */
  clearContext(contactId, type) {
    const key = `${contactId}_${type}`;
    this.contexts.delete(key);
    console.log(`🧹 Contexto limpo: ${key}`);
  }

  /**
   * Limpa todos os contextos de um contato
   */
  clearAllContexts(contactId) {
    const keysToDelete = [];
    for (const key of this.contexts.keys()) {
      if (key.startsWith(`${contactId}_`)) {
        keysToDelete.push(key);
      }
    }
    
    keysToDelete.forEach(key => this.contexts.delete(key));
    console.log(`🧹 Todos os contextos limpos para: ${contactId}`);
  }

  /**
   * Obtém estatísticas do serviço
   */
  getStats() {
    return {
      activeContexts: this.contexts.size,
      queueSize: this.queue.size,
      memoryUsage: process.memoryUsage(),
      uptime: process.uptime()
    };
  }

  /**
   * Verifica se o serviço está funcionando
   */
  async healthCheck() {
    try {
      const testResponse = await this.ollama.chat({
        model: CONFIG.llm.model,
        messages: [{ role: 'user', content: 'test' }]
      });
      
      return { 
        status: 'ok', 
        service: 'LLMService',
        model: CONFIG.llm.model,
        host: CONFIG.llm.host
      };
    } catch (err) {
      return { 
        status: 'error', 
        service: 'LLMService', 
        error: err.message 
      };
    }
  }
}

export default LLMService;

