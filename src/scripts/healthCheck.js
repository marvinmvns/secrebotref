#!/usr/bin/env node

/**
 * Script de verificação de saúde do sistema
 * Verifica se todos os serviços estão funcionando corretamente
 */

import UnifiedAIService from '../services/unifiedAIService.js';

async function healthCheck() {
  console.log('🏥 Iniciando verificação de saúde do sistema...\n');
  
  const aiService = new UnifiedAIService();
  
  try {
    // Inicializar serviços
    await aiService.initialize();
    
    // Executar health check
    const health = await aiService.healthCheck();
    
    console.log('📊 Resultado da verificação:');
    console.log(`Status geral: ${health.status}`);
    console.log(`Timestamp: ${health.timestamp}`);
    console.log(`Inicializado: ${health.initialized}\n`);
    
    // Detalhes por serviço
    health.services.forEach(service => {
      const icon = service.status === 'ok' ? '✅' : '❌';
      console.log(`${icon} ${service.service}: ${service.status}`);
      
      if (service.status === 'error') {
        console.log(`   Erro: ${service.details.error}`);
      }
    });
    
    // Estatísticas do sistema
    console.log('\n📈 Estatísticas:');
    const stats = aiService.getStats();
    console.log(`Uptime: ${Math.floor(stats.uptime / 60)} minutos`);
    console.log(`Memória usada: ${Math.round(stats.memory.heapUsed / 1024 / 1024)} MB`);
    console.log(`Contextos LLM ativos: ${stats.llm.activeContexts}`);
    
    // Determinar código de saída
    const exitCode = health.status === 'healthy' ? 0 : 1;
    
    console.log(`\n${health.status === 'healthy' ? '✅' : '⚠️'} Verificação concluída`);
    
    await aiService.shutdown();
    process.exit(exitCode);
    
  } catch (err) {
    console.error('❌ Erro na verificação de saúde:', err.message);
    await aiService.shutdown();
    process.exit(1);
  }
}

// Executar se chamado diretamente
if (import.meta.url === `file://${process.argv[1]}`) {
  healthCheck().catch(err => {
    console.error('❌ Erro fatal:', err);
    process.exit(1);
  });
}

export default healthCheck;

