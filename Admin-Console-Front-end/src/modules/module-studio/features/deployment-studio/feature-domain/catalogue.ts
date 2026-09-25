import {
  AppWindow,
  Box,
  Boxes,
  Cable,
  Cpu,
  LogIn,
  LogOut,
  PackageOpen,
  ServerCog,
} from 'lucide-react';
import type { InputChannelType, OutputChannelType, ProjectTarget } from './types';

export const TARGETS: Array<{ value: ProjectTarget; label: string; hint: string }> = [
  {
    value: 'ENVIRONNEMENT_EXECUTION_ROBOT',
    label: 'Ordinateur du robot',
    hint: 'Services exécutés près des capteurs et actionneurs.',
  },
  {
    value: 'ENVIRONNEMENT_EXECUTION_SERVEUR',
    label: 'Serveur OSCAR',
    hint: 'Traitements centralisés et services accessibles à distance.',
  },
  {
    value: 'ENVIRONNEMENT_EXECUTION_NAVIGATEUR_WEB',
    label: 'Navigateur web',
    hint: 'Téléopération ou supervision depuis une interface web.',
  },
  {
    value: 'ENVIRONNEMENT_EXECUTION_APPLICATION_METIER',
    label: 'Autre application métier',
    hint: 'Logiciel web, bureau, mobile ou Python connecté à OSCAR.',
  },
];

export const INPUT_TYPES: Array<{ value: InputChannelType; label: string; hint: string }> = [
  {
    value: 'TYPE_ENTREE_INJECTION_APPLICATION',
    label: 'Donnée fournie par l’application',
    hint: 'La logique de l’application appelle directement le canal.',
  },
  {
    value: 'TYPE_ENTREE_ABONNEMENT_TEMPS_REEL',
    label: 'Abonnement temps réel',
    hint: 'Reçoit les données émises par un autre module de la salle du robot.',
  },
  {
    value: 'TYPE_ENTREE_SERVICE_LOCAL',
    label: 'Service présent sur la même machine',
    hint: 'Reçoit une donnée par communication locale.',
  },
  {
    value: 'TYPE_ENTREE_CONSOMMATION_COURTIER_MESSAGES',
    label: 'Courtier de messages',
    hint: 'Consomme un sujet publié sur un système de messages.',
  },
  {
    value: 'TYPE_ENTREE_ABONNEMENT_ROS_2',
    label: 'Canal ROS 2 du robot',
    hint: 'S’abonne à un sujet ROS 2, par exemple un capteur.',
  },
];

export const OUTPUT_TYPES: Array<{ value: OutputChannelType; label: string; hint: string }> = [
  {
    value: 'TYPE_SORTIE_PUBLICATION_TEMPS_REEL_CANAL_AGENT',
    label: 'Canal précis d’un module',
    hint: 'Envoie en temps réel vers un canal de réception précis.',
  },
  {
    value: 'TYPE_SORTIE_PUBLICATION_TEMPS_REEL_PLUSIEURS_CANAUX',
    label: 'Plusieurs canaux temps réel',
    hint: 'Diffuse la même donnée à plusieurs destinations configurées.',
  },
  {
    value: 'TYPE_SORTIE_RAPPEL_APPLICATION',
    label: 'Rappel vers l’application',
    hint: 'Déclenche une fonction fournie par l’application intégratrice.',
  },
  {
    value: 'TYPE_SORTIE_SERVICE_LOCAL',
    label: 'Service présent sur la même machine',
    hint: 'Transmet par communication locale.',
  },
  {
    value: 'TYPE_SORTIE_PUBLICATION_COURTIER_MESSAGES',
    label: 'Publication vers un courtier de messages',
    hint: 'Publie la donnée sur un sujet externe.',
  },
  {
    value: 'TYPE_SORTIE_PUBLICATION_ROS_2',
    label: 'Publication vers ROS 2',
    hint: 'Publie vers un sujet ROS 2 du robot.',
  },
];

export const PALETTE_ITEMS = [
  {
    type: 'BUNDLE_DEPLOIEMENT',
    label: 'Bundle de déploiement',
    hint: 'Regroupe les composants publiés ensemble.',
    icon: PackageOpen,
    tone: 'violet',
  },
  {
    type: 'INSTANCE_SERVICE',
    label: 'Service',
    hint: 'Unité d’exécution déployable.',
    icon: ServerCog,
    tone: 'blue',
  },
  {
    type: 'INSTANCE_APPLICATION',
    label: 'Application',
    hint: 'Interface web, bureau ou métier.',
    icon: AppWindow,
    tone: 'cyan',
  },
  {
    type: 'INSTANCE_AGENT',
    label: 'Module',
    hint: 'Traitement métier avec interface de communication.',
    icon: Cpu,
    tone: 'amber',
  },
  {
    type: 'CANAL_RECEPTION',
    label: 'Canal de réception',
    hint: 'Entrée unitaire d’un module.',
    icon: LogIn,
    tone: 'green',
  },
  {
    type: 'CANAL_EMISSION',
    label: 'Canal d’émission',
    hint: 'Sortie unitaire d’un module.',
    icon: LogOut,
    tone: 'rose',
  },
];

export const HIERARCHY_ITEMS = [
  { label: 'Bundle de déploiement', code: 'BUNDLE_DEPLOIEMENT', icon: Boxes },
  { label: 'Service ou application', code: 'INSTANCE_SERVICE / INSTANCE_APPLICATION', icon: Box },
  { label: 'Module', code: 'INSTANCE_AGENT', icon: Cpu },
  { label: 'Interface de communication', code: 'INTERFACE_COMMUNICATION_AGENT', icon: Cable },
];
