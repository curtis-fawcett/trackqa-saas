import { useParams } from 'react-router-dom';
import { Card, CardContent, CardTitle } from '@/components/ui/card';

export function ProjectDetail() {
  const { id } = useParams<{ id: string }>();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Project Details</h1>
        <p className="text-slate-400 mt-1">Project ID: {id}</p>
      </div>
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <CardTitle className="text-lg text-slate-400 mb-2">Ticket Board Coming Soon</CardTitle>
          <p className="text-sm text-slate-600 max-w-sm">
            The kanban board and ticket management will be built here.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
