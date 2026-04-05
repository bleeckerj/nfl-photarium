import { ClientPageCreateForm } from '@/features/client-pages/ui/ClientPageCreateForm';

export default function NewClientPagePage() {
  return (
    <main className="min-h-screen bg-stone-50 px-4 py-8">
      <div className="mx-auto max-w-4xl">
        <ClientPageCreateForm />
      </div>
    </main>
  );
}
