import 'dotenv/config';
import { TsMorphMetadataProvider } from '@mikro-orm/reflection';
import { createOrmConfig } from './src/database/orm.config.js';

const config = createOrmConfig();
export default { ...config, metadataProvider: TsMorphMetadataProvider };
