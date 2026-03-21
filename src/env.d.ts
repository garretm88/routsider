/// <reference types="astro/client" />

interface AdminUser {
  id: string;
  email: string;
  name: string;
  createdAt: string;
}

declare namespace App {
  interface Locals {
    user?: AdminUser;
  }
}
