import { useParams } from 'react-router-dom';
import { Card, CardContent, CardTitle } from '@/components/ui/card';

export function TicketDetail() {
  const { id } = useParams<{ id: string }>();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Ticket Details</h1>
        <p className="text-slate-400 mt-1">Ticket ID: {id}</p>
      </div>
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <CardTitle className="text-lg text-slate-400 mb-2">Ticket View Coming Soon</CardTitle>
          <p className="text-sm text-slate-600 max-w-sm">
            Full ticket detail view with comments, status changes, and activity log will be built here.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
