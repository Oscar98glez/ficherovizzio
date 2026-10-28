import { Briefcase } from 'lucide-react';
import { Card, EmptyState, PageHeader } from '../../components/ui';

/** Apartado de los administrativos. Todavía vacío: se irá montando a partir de sus Excel. */
export default function Administration() {
  return (
    <>
      <PageHeader title="Administración" subtitle="El apartado de los administrativos." />
      <Card>
        <EmptyState
          icon={<Briefcase />}
          title="Aún no hay nada aquí"
          message="Este apartado se preparará con los datos y la vista de los Excel de administración."
        />
      </Card>
    </>
  );
}
