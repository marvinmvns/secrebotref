#!/usr/bin/env node

/**
 * Script de limpeza do sistema
 * Remove arquivos temporários e otimiza o uso de memória
 */

import { promises as fs } from 'fs';
import path from 'path';
import UnifiedAIService from '../services/unifiedAIService.js';

async function cleanup() {
  console.log('🧹 Iniciando limpeza do sistema...\n');
  
  const aiService = new UnifiedAIService();
  let cleaned = {
    tempFiles: 0,
    contexts: 0,
    memoryFreed: 0
  };
  
  try {
    // Inicializar serviços
    await aiService.initialize();
    
    // 1. Limpar arquivos temporários
    console.log('📁 Limpando arquivos temporários...');
    await aiService.cleanup();
    
    // 2. Limpar contextos antigos
    console.log('🧠 Limpando contextos LLM antigos...');
    const statsBefore = aiService.getStats();
    aiService.llmService.cleanupOldContexts();
    const statsAfter = aiService.getStats();
    
    cleaned.contexts = statsBefore.llm.activeContexts - statsAfter.llm.activeContexts;
    
    // 3. Forçar garbage collection se disponível
    if (global.gc) {
      console.log('♻️ Executando garbage collection...');
      const memBefore = process.memoryUsage().heapUsed;
      global.gc();
      const memAfter = process.memoryUsage().heapUsed;
      cleaned.memoryFreed = Math.round((memBefore - memAfter) / 1024 / 1024);
    }
    
    // 4. Limpar diretórios temporários específicos
    console.log('📂 Limpando diretórios temporários...');
    const tempDirs = [
      path.join(process.cwd(), 'temp'),
      path.join(process.cwd(), 'src', 'temp'),
      '/tmp'
    ];
    
    for (const tempDir of tempDirs) {
      try {
        const files = await fs.readdir(tempDir);
        const now = Date.now();
        const maxAge = 3600000; // 1 hora
        
        for (const file of files) {
          if (file.startsWith('audio_') || file.startsWith('subs_') || file.startsWith('video_')) {
            const filePath = path.join(tempDir, file);
            const stats = await fs.stat(filePath);
            
            if (now - stats.mtime.getTime() > maxAge) {
              await fs.unlink(filePath);
              cleaned.tempFiles++;
            }
          }
        }
      } catch (err) {
        // Diretório pode não existir, ignorar
      }
    }
    
    // Relatório final
    console.log('\n📊 Relatório de limpeza:');
    console.log(`🗑️ Arquivos temporários removidos: ${cleaned.tempFiles}`);
    console.log(`🧠 Contextos LLM limpos: ${cleaned.contexts}`);
    if (cleaned.memoryFreed > 0) {
      console.log(`♻️ Memória liberada: ${cleaned.memoryFreed} MB`);
    }
    
    // Estatísticas finais
    const finalStats = aiService.getStats();
    console.log(`💾 Memória atual: ${Math.round(finalStats.memory.heapUsed / 1024 / 1024)} MB`);
    console.log(`🧠 Contextos ativos: ${finalStats.llm.activeContexts}`);
    
    console.log('\n✅ Limpeza concluída com sucesso');
    
    await aiService.shutdown();
    process.exit(0);
    
  } catch (err) {
    console.error('❌ Erro na limpeza:', err.message);
    await aiService.shutdown();
    process.exit(1);
  }
}

// Executar se chamado diretamente
if (import.meta.url === `file://${process.argv[1]}`) {
  cleanup().catch(err => {
    console.error('❌ Erro fatal:', err);
    process.exit(1);
  });
}

export default cleanup;

