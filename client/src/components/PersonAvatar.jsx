import { UserRound } from 'lucide-react';
import { useState } from 'react';
import { apiUrl } from '../api/client';

export function PersonAvatar({ person, className = '' }) {
  const imageSrc = person.avatar_face_id
    ? apiUrl(`/faces/people/${person.id}/avatar?v=${person.avatar_face_id}`)
    : '';
  const [failedSrc, setFailedSrc] = useState('');

  return (
    <div className={`relative overflow-hidden bg-slate-100 ${className}`}>
      <div className="absolute inset-0 flex items-center justify-center text-slate-300">
        <UserRound className="h-1/2 w-1/2" strokeWidth={1.5} />
      </div>
      {imageSrc && failedSrc !== imageSrc && (
        <img
          src={imageSrc}
          alt=""
          loading="lazy"
          className="absolute inset-0 h-full w-full object-cover"
          onError={() => setFailedSrc(imageSrc)}
        />
      )}
    </div>
  );
}
