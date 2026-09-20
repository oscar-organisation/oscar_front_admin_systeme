import { describe, expect, it } from 'vitest';
import {
  createAgent,
  createArchitectureNode,
  createProject,
  validateProject,
} from './model';
import type { ArchitectureEdge } from './types';

describe('modèle de configuration OSCAR', () => {
  it('crée un projet vide avec son bundle de déploiement', () => {
    const project = createProject(
      'Robot test',
      'Projet de test',
      'ENVIRONNEMENT_EXECUTION_ROBOT',
      'VIDE',
    );

    const [bundle] = project.nodes;
    expect(project.nodes).toHaveLength(1);
    expect(bundle?.data.kind).toBe('BUNDLE_DEPLOIEMENT');
    expect(bundle?.data.technicalCode).toBe('BUNDLE_DEPLOIEMENT_ROBOT_TEST');
  });

  it('crée automatiquement toute la structure minimale d’un agent', () => {
    const agent = createAgent(1, true);

    expect(agent.processingName).toMatch(/^TRAITEMENT_METIER_AGENT_/);
    expect(agent.interfaceName).toMatch(/^INTERFACE_COMMUNICATION_AGENT_/);
    expect(agent.dataBandName).toMatch(/^BANDE_DONNEES_/);
    expect(agent.receiveBusName).toMatch(/^BUS_RECEPTION_/);
    expect(agent.sendBusName).toMatch(/^BUS_EMISSION_/);
    expect(agent.inputs).toHaveLength(1);
    expect(agent.outputs).toHaveLength(1);
  });

  it('détecte une liaison dont les formats de données sont incompatibles', () => {
    const serviceA = createArchitectureNode(
      'INSTANCE_SERVICE',
      1,
      'ENVIRONNEMENT_EXECUTION_ROBOT',
      { x: 0, y: 0 },
    );
    const serviceB = createArchitectureNode(
      'INSTANCE_SERVICE',
      2,
      'ENVIRONNEMENT_EXECUTION_ROBOT',
      { x: 500, y: 0 },
    );
    const emitter = createAgent(1, true);
    const receiver = createAgent(2, true);
    const [emitterOutput] = emitter.outputs;
    const [receiverInput] = receiver.inputs;
    if (!emitterOutput || !receiverInput) throw new Error('Agent créé sans canal.');
    emitterOutput.dataFormat = 'BINAIRE_COMPACT';
    receiverInput.dataFormat = 'OBJET_JSON';
    serviceA.data.agents = [emitter];
    serviceB.data.agents = [receiver];

    const edge: ArchitectureEdge = {
      id: 'liaison-test',
      source: serviceA.id,
      sourceHandle: `out:${emitter.id}:${emitterOutput.id}`,
      target: serviceB.id,
      targetHandle: `in:${receiver.id}:${receiverInput.id}`,
      data: { edgeKind: 'DONNEES' },
    };
    const project = {
      ...createProject('Test', '', 'ENVIRONNEMENT_EXECUTION_ROBOT', 'VIDE'),
      nodes: [serviceA, serviceB],
      edges: [edge],
    };

    expect(validateProject(project)).toEqual(expect.arrayContaining([
      expect.objectContaining({ level: 'ERREUR', title: 'Formats de données incompatibles' }),
    ]));
  });
});
