import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'chat' },
  {
    path: 'chat',
    title: 'Chat · WorkMate AI',
    loadComponent: () => import('./features/chat/chat.component').then((m) => m.ChatComponent),
  },
  {
    path: 'system',
    title: 'System status · WorkMate AI',
    loadComponent: () => import('./features/system/system.component').then((m) => m.SystemComponent),
  },
  { path: '**', redirectTo: 'chat' },
];
